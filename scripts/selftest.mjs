#!/usr/bin/env node
/**
 * Pure-logic checks: ramp maths, timezone-safe date diffing, template
 * rendering. No network, no credentials. Run with: npm run selftest
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysBetween,
  isWithinWindow,
  quotaForDay,
  formatDateInTz,
  hasStarted,
  withinRange,
  isoToReportingDate,
} from "../lib/time.ts";
import { render, extractVariables, unknownVariables, textToHtml } from "../lib/template.ts";
import { isClaimable, sendingMarker, STUCK_AFTER_MS } from "../lib/lead-status.ts";
import { parseCsv, detectDelimiter, normalizeHeaders } from "../lib/csv.ts";
import { safeTabName, uniqueTabName } from "../lib/naming.ts";
import { variableMap } from "../lib/variables.ts";
import { extractEmails, isBounce, matchInbound } from "../lib/inbound-classify.ts";
import { costFromUsage } from "../lib/ai-usage.ts";
import { parseRecipients, hasRecipient, formatRecipients } from "../lib/recipients.ts";
import {
  followUpDue,
  followUpStepIndex,
  stepAt,
  followUpSubject,
  clampMaxFollowUps,
  clampDayGap,
} from "../lib/follow-up.ts";
import {
  isSentStatus,
  isFollowUpCandidate,
  DEFAULT_SENT_VALUE,
} from "../lib/selection.ts";
import {
  grossProfit,
  revenue,
  monthlyGrossProfit,
  countByType,
  computeMetrics,
  ratio,
  rate,
  ltgpCacHealth,
  dailyVolume,
  senderHealth,
} from "../lib/metrics.ts";

test("ramp reaches the cap and never exceeds it", () => {
  const q = (day) => quotaForDay(day, 5, 1, 30);
  assert.equal(q(1), 5);
  assert.equal(q(10), 14);
  assert.equal(q(26), 30);
  assert.equal(q(121), 30);
  assert.equal(q(0), 0);
});

test("a campaign waits until its start date, but 'run now' overrides", () => {
  assert.equal(hasStarted("2026-07-28", "2026-07-26"), false); // future start: wait
  assert.equal(hasStarted("2026-07-26", "2026-07-26"), true); // starts today
  assert.equal(hasStarted("2026-07-20", "2026-07-26"), true); // already started
  assert.equal(hasStarted("", "2026-07-26"), true); // no scheduled start
});

test("no ramp means a flat daily limit", () => {
  assert.equal(quotaForDay(1, 30, 0, 30), 30);
  assert.equal(quotaForDay(121, 30, 0, 30), 30);
});

test("firstDayVolume above the cap is still capped", () => {
  assert.equal(quotaForDay(1, 100, 5, 30), 30);
});

test("daysBetween counts calendar days across a DST change", () => {
  // Europe/Athens moves to summer time on 2026-03-29.
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(daysBetween("2026-01-01", "2026-01-01"), 0);
  assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
});

test("send window respects the campaign timezone", () => {
  // 07:30 UTC is 10:30 in Athens (summer) and 07:30 in London.
  const noon = new Date("2026-07-24T07:30:00Z");
  assert.equal(isWithinWindow(noon, "Europe/Athens", "09:00", "17:00"), true);
  assert.equal(isWithinWindow(noon, "Europe/Athens", "11:00", "17:00"), false);
  assert.equal(isWithinWindow(noon, "Europe/London", "09:00", "17:00"), false);
});

test("dates are formatted in the campaign timezone, not UTC", () => {
  // 22:30 UTC is already the next day in Athens.
  const late = new Date("2026-07-24T22:30:00Z");
  assert.equal(formatDateInTz(late, "Europe/Athens"), "2026-07-25");
  assert.equal(formatDateInTz(late, "UTC"), "2026-07-24");
});

test("render substitutes columns, tolerating case and spacing", () => {
  const vars = { "Greek Name": "Γιώργος", Company: "Acme", ai_output: "Line." };
  assert.equal(render("Γεια σου {{Greek Name}},", vars), "Γεια σου Γιώργος,");
  assert.equal(render("{{ company }}", vars), "Acme");
  assert.equal(render("{{ai_output}}", vars), "Line.");
});

test("unknown variables render empty rather than leaking braces", () => {
  assert.equal(render("Hi {{Nope}}!", { Company: "Acme" }), "Hi !");
});

test("variable extraction and validation", () => {
  const tpl = "{{First Name}} at {{Company}} — {{ai_output}}";
  assert.deepEqual(extractVariables(tpl), ["First Name", "Company", "ai_output"]);
  assert.deepEqual(unknownVariables(tpl, ["first name", "Company", "ai_output"]), []);
  assert.deepEqual(unknownVariables(tpl, ["Company"]), ["First Name", "ai_output"]);
});

test("a lead is claimable only when free or abandoned", () => {
  const now = Date.now();
  assert.equal(isClaimable("", now), true, "blank cell is free");
  assert.equal(isClaimable("   ", now), true, "whitespace counts as blank");
  assert.equal(isClaimable("Sent", now), false, "already contacted");
  assert.equal(isClaimable("Error", now), false, "failed rows are not retried");
  assert.equal(isClaimable("Replied", now), false, "any other value is respected");
});

test("a fresh Sending claim blocks a second tick, a stale one is recovered", () => {
  const now = Date.now();
  assert.equal(isClaimable(sendingMarker(new Date(now)), now), false, "just claimed");
  assert.equal(
    isClaimable(sendingMarker(new Date(now - STUCK_AFTER_MS + 60_000)), now),
    false,
    "still inside the recovery window",
  );
  assert.equal(
    isClaimable(sendingMarker(new Date(now - STUCK_AFTER_MS - 1000)), now),
    true,
    "tick died, row is released",
  );
  assert.equal(isClaimable("Sending", now), true, "marker with no timestamp is treated as stale");
});

test("plain text becomes safe HTML with paragraph breaks", () => {
  assert.equal(textToHtml("a\n\nb"), "<p>a</p>\n<p>b</p>");
  assert.equal(textToHtml("a\nb"), "<p>a<br>b</p>");
  assert.equal(textToHtml("<script>"), "<p>&lt;script&gt;</p>");
});

test("CSV parsing survives quotes, commas and newlines inside fields", () => {
  const csv = 'Name,Email,Note\n"Acme, Inc.",a@b.com,"line one\nline two"\n';
  assert.deepEqual(parseCsv(csv), [
    ["Name", "Email", "Note"],
    ["Acme, Inc.", "a@b.com", "line one\nline two"],
  ]);
});

test("CSV parsing handles escaped quotes, CRLF and a BOM", () => {
  const csv = '﻿a,b\r\n"say ""hi""",2\r\n';
  assert.deepEqual(parseCsv(csv), [
    ["a", "b"],
    ['say "hi"', "2"],
  ]);
});

test("blank CSV lines are dropped, not turned into empty leads", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n\n,\n3,4\n"), [
    ["a", "b"],
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("the CSV delimiter is detected from the header line", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(detectDelimiter("a,b\n1,2"), ",");
  assert.equal(detectDelimiter("single"), ",");
});

test("duplicate and blank CSV headers are made unique", () => {
  // readObjects keys rows by header, so collisions would silently lose a column.
  assert.deepEqual(normalizeHeaders(["Email", "", "Email", " Email "]), [
    "Email",
    "Column 2",
    "Email 2",
    "Email 3",
  ]);
});

test("campaign names become legal sheet tab names", () => {
  assert.equal(safeTabName("Accounting Firms Q3"), "Accounting Firms Q3");
  assert.equal(safeTabName("A/B: test [2026]?"), "A B test 2026");
  assert.equal(safeTabName("   "), "Leads");
  assert.equal(safeTabName("x".repeat(200)).length, 90);
});

test("a working tab never overwrites an existing tab of the same name", () => {
  assert.equal(uniqueTabName(["Leads"], "Accounting"), "Accounting");
  assert.equal(uniqueTabName(["Accounting"], "Accounting"), "Accounting 2");
  assert.equal(uniqueTabName(["Accounting", "Accounting 2"], "Accounting"), "Accounting 3");
});

test("custom variables fill in, but a sheet column of the same name wins", () => {
  const variables = [
    { name: "my_offer", value: "AI automation" },
    { name: "Company", value: "SHOULD NOT WIN" },
    { name: "  ", value: "ignored" },
  ];
  const vars = { ...variableMap(variables), Company: "Acme" };
  assert.equal(render("{{my_offer}} for {{Company}}", vars), "AI automation for Acme");
  assert.equal(Object.hasOwn(variableMap(variables), "  "), false, "blank names are dropped");
});

test("bounce detection covers postmaster senders and NDR subjects (EN + EL)", () => {
  assert.equal(isBounce({ fromName: "Microsoft Outlook", fromAddress: "postmaster@corp.com" }), true);
  assert.equal(isBounce({ fromName: "Mail Delivery Subsystem", fromAddress: "mailer-daemon@x" }), true);
  assert.equal(isBounce({ subject: "Undeliverable: quick question" }), true);
  assert.equal(isBounce({ subject: "Δεν παραδόθηκε: πρόταση" }), true);
  assert.equal(isBounce({ fromAddress: "andreas@acme.gr", subject: "Re: quick question" }), false);
});

test("extractEmails finds, lowercases and dedupes addresses in any text", () => {
  const html = 'Failed for <b>Andreas@Acme.GR</b>; also andreas@acme.gr and me@myco.com';
  assert.deepEqual(extractEmails(html).sort(), ["andreas@acme.gr", "me@myco.com"]);
});

test("matchInbound maps replies and bounces to the right lead and kind", () => {
  const leads = new Set(["andreas@acme.gr", "maria@beta.gr"]);

  // A real reply: sender is the lead.
  assert.deepEqual(
    matchInbound(
      { fromAddress: "andreas@acme.gr", subject: "Re: proposal", candidateEmails: ["andreas@acme.gr", "me@myco.com"] },
      leads,
      "me@myco.com",
    ),
    { email: "andreas@acme.gr", kind: "reply" },
  );

  // A bounce: postmaster sender, failed lead address is inside the body.
  assert.deepEqual(
    matchInbound(
      {
        fromAddress: "postmaster@acme.gr",
        fromName: "Microsoft Outlook",
        subject: "Undeliverable: proposal",
        candidateEmails: ["postmaster@acme.gr", "me@myco.com", "maria@beta.gr"],
      },
      leads,
      "me@myco.com",
    ),
    { email: "maria@beta.gr", kind: "bounce" },
  );

  // The mailbox's own address never counts as a lead, and unknown mail is null.
  assert.equal(
    matchInbound({ fromAddress: "me@myco.com", candidateEmails: ["me@myco.com"] }, leads, "me@myco.com"),
    null,
  );
});

const deal = (over = {}) => ({
  id: "o1",
  campaignId: "c1",
  folderId: "f1",
  leadEmail: "a@b.com",
  leadName: "",
  company: "",
  type: "closed",
  occurredAt: "2026-08-01T10:00:00.000Z",
  dealType: "oneoff",
  dealValueUsd: 0,
  monthlyValueUsd: 0,
  expectedMonths: 0,
  grossMarginPct: 0,
  note: "",
  createdAt: "2026-08-01T10:00:00.000Z",
  ...over,
});

test("a one-off deal takes margin off the total value, once", () => {
  const outcome = deal({ dealType: "oneoff", dealValueUsd: 2000, grossMarginPct: 70 });
  assert.equal(revenue(outcome), 2000);
  assert.equal(grossProfit(outcome), 1400);
  // A one-off has no monthly profit, so it can never drive a payback period.
  assert.equal(monthlyGrossProfit(outcome), 0);
});

test("a recurring deal multiplies out the expected months", () => {
  const outcome = deal({
    dealType: "recurring",
    monthlyValueUsd: 500,
    expectedMonths: 12,
    grossMarginPct: 80,
  });
  assert.equal(revenue(outcome), 6000);
  assert.equal(grossProfit(outcome), 4800);
  assert.equal(monthlyGrossProfit(outcome), 400);
});

test("only closed deals carry money", () => {
  assert.equal(grossProfit(deal({ type: "booked", dealValueUsd: 9999, grossMarginPct: 100 })), 0);
  assert.equal(revenue(deal({ type: "lost", dealValueUsd: 9999 })), 0);
});

test("empty denominators read as no data, never as zero or Infinity", () => {
  assert.equal(ratio(10, 0), null);
  assert.equal(rate(3, 0), null);
  assert.equal(ratio(0, 4), 0);
  const m = computeMetrics(
    { leadsTotal: 100, leadsContacted: 0, emailsSent: 0, bounced: 0, replied: 0 },
    [],
    { apify: 0, ai: 0, other: 0, total: 12 },
  );
  assert.equal(m.money.cac, null);
  assert.equal(m.money.ltgpToCac, null);
  assert.equal(m.rates.bookingRate, null);
  assert.equal(m.money.ltgp, 0);
});

test("counting outcomes is per row, so a duplicate row would double count", () => {
  // The guard against this lives in addOutcome, which is idempotent on
  // (campaignId, leadEmail, type). This test pins the counting behaviour that
  // makes the guard necessary.
  const one = countByType([deal({ type: "booked" })]);
  assert.equal(one.booked, 1);
  const two = countByType([deal({ type: "booked" }), deal({ type: "booked", id: "o2" })]);
  assert.equal(two.booked, 2);
});

test("CAC, LTGP and the ratio compute off closed deals only", () => {
  const outcomes = [
    deal({ id: "a", type: "positive_reply" }),
    deal({ id: "b", type: "booked" }),
    deal({ id: "c", type: "showed" }),
    deal({ id: "d", type: "closed", dealType: "oneoff", dealValueUsd: 3000, grossMarginPct: 60 }),
    deal({
      id: "e",
      type: "closed",
      dealType: "recurring",
      monthlyValueUsd: 400,
      expectedMonths: 10,
      grossMarginPct: 50,
    }),
  ];
  const m = computeMetrics(
    { leadsTotal: 500, leadsContacted: 400, emailsSent: 400, bounced: 8, replied: 20 },
    outcomes,
    { apify: 100, ai: 20, other: 80, total: 200 },
  );

  assert.equal(m.funnel.closed, 2);
  assert.equal(m.money.ltgp, 1800 + 2000);
  assert.equal(m.money.cac, 100); // 200 spend / 2 customers
  assert.equal(m.money.ltgpPerCustomer, 1900);
  assert.equal(m.money.ltgpToCac, 19);
  assert.equal(m.money.contributionMargin, 1800);
  assert.equal(m.volume.delivered, 392);
  assert.equal(m.rates.bounceRate, 2);
  // Payback ignores the one-off and uses the recurring deal's monthly profit.
  assert.equal(m.money.paybackMonths, 0.5);
});

test("LTGP:CAC health bands follow the stated targets", () => {
  assert.equal(ltgpCacHealth(null), "unknown");
  assert.equal(ltgpCacHealth(2.4), "bad");
  assert.equal(ltgpCacHealth(4), "ok");
  assert.equal(ltgpCacHealth(7), "good");
});

test("a spend row near midnight Athens lands in the right month", () => {
  // 2026-07-31T22:30Z is already 01:30 on 1 August in Athens (UTC+3).
  // Comparing the raw ISO string against a YYYY-MM-DD bound would file it
  // under July and quietly understate August.
  assert.equal(isoToReportingDate("2026-07-31T22:30:00.000Z"), "2026-08-01");
  assert.equal(isoToReportingDate("2026-07-31T20:30:00.000Z"), "2026-07-31");

  const august = { from: "2026-08-01", to: "2026-08-31" };
  assert.equal(withinRange(isoToReportingDate("2026-07-31T22:30:00.000Z"), august), true);
  assert.equal(withinRange(isoToReportingDate("2026-07-31T20:30:00.000Z"), august), false);
});

test("an unbounded range accepts any real date but never a blank one", () => {
  assert.equal(withinRange("2026-08-11", {}), true);
  assert.equal(withinRange("", {}), false);
  assert.equal(withinRange("2026-08-11", { from: "2026-08-11", to: "2026-08-11" }), true);
});

test("AI cost comes from the inline usage block, and junk reads as zero", () => {
  // Shape measured against the live API: usage.cost, a number, in USD.
  assert.equal(costFromUsage({ prompt_tokens: 9, completion_tokens: 12, cost: 0.000207 }), 0.000207);
  assert.equal(costFromUsage({ cost: 0 }), 0);
  assert.equal(costFromUsage(undefined), 0);
  assert.equal(costFromUsage({}), 0);
  assert.equal(costFromUsage({ cost: "0.5" }), 0);
  assert.equal(costFromUsage({ cost: Number.NaN }), 0);
  assert.equal(costFromUsage({ cost: -1 }), 0);
});

test("daily volume groups by day and by sending address", () => {
  const v = dailyVolume([
    { date: "2026-08-11", sender: "a@x.com" },
    { date: "2026-08-11", sender: "a@x.com" },
    { date: "2026-08-11", sender: "b@y.com" },
    { date: "2026-08-10", sender: "a@x.com" },
    { date: "", sender: "a@x.com" },
  ]);
  assert.deepEqual(v.dates, ["2026-08-11", "2026-08-10"]);
  assert.deepEqual(v.senders, ["a@x.com", "b@y.com"]);
  assert.equal(v.counts["2026-08-11"]["a@x.com"], 2);
  assert.equal(v.counts["2026-08-11"]["b@y.com"], 1);
  assert.equal(v.perDayTotal["2026-08-11"], 3);
  // A row with no usable timestamp is dropped, not filed under an empty day.
  assert.equal(v.perDayTotal[""], undefined);
});

test("per-mailbox daily volume warns before it burns the domain", () => {
  assert.equal(senderHealth(30), "ok");
  assert.equal(senderHealth(45), "warn");
  assert.equal(senderHealth(80), "bad");
});

test("a cell with several addresses becomes several recipients", () => {
  assert.deepEqual(parseRecipients("a@x.com, b@y.com"), ["a@x.com", "b@y.com"]);
  assert.deepEqual(parseRecipients("a@x.com;b@y.com"), ["a@x.com", "b@y.com"]);
  assert.deepEqual(parseRecipients("a@x.com\nb@y.com"), ["a@x.com", "b@y.com"]);
  // Trailing separators and stray spacing are what real sheets actually contain.
  assert.deepEqual(parseRecipients("  a@x.com ,  "), ["a@x.com"]);
  assert.deepEqual(parseRecipients("Info <a@x.com>, b@y.com"), ["a@x.com", "b@y.com"]);
});

test("recipient parsing lowercases, de-duplicates and drops junk", () => {
  assert.deepEqual(parseRecipients("A@X.com, a@x.com"), ["a@x.com"]);
  // A malformed entry must not travel to Graph, where it fails the whole send.
  assert.deepEqual(parseRecipients("not-an-email, b@y.com"), ["b@y.com"]);
  assert.deepEqual(parseRecipients("a@nodot, b@y.com"), ["b@y.com"]);
  assert.deepEqual(parseRecipients(""), []);
  assert.deepEqual(parseRecipients("   "), []);
  assert.equal(hasRecipient("a@x.com"), true);
  assert.equal(hasRecipient("nonsense"), false);
  assert.equal(formatRecipients("A@X.com , b@y.com"), "a@x.com, b@y.com");
});

const rec = (over = {}) => ({ count: 1, lastDate: "2026-08-01", lastSubject: "Quick question", ...over });

test("a follow-up is due only after the gap, and only within the allowance", () => {
  const s = { dayGap: 5, maxFollowUps: 2 };
  assert.equal(followUpDue(rec(), s, 4), false);
  assert.equal(followUpDue(rec(), s, 5), true);
  assert.equal(followUpDue(rec(), s, 19), true);
  // count 3 means the first touch plus two follow-ups, the allowance is used up.
  assert.equal(followUpDue(rec({ count: 3 }), s, 19), false);
  assert.equal(followUpDue(rec({ count: 2 }), s, 19), true);
});

test("a lead with no logged send is never followed up", () => {
  const s = { dayGap: 5, maxFollowUps: 3 };
  // Rows an older tool marked Sent have no history here. Guessing would email
  // someone a second time with no idea when the first went out.
  assert.equal(followUpDue(undefined, s, 19), false);
  assert.equal(followUpDue(rec({ count: 0 }), s, 19), false);
  assert.equal(followUpDue(rec({ lastDate: "" }), s, 19), false);
});

test("follow-ups are off when the allowance is zero", () => {
  assert.equal(followUpDue(rec(), { dayGap: 1, maxFollowUps: 0 }, 60), false);
  assert.equal(clampMaxFollowUps(0), 0);
  assert.equal(clampMaxFollowUps(-2), 0);
  // Three is the cap George asked for.
  assert.equal(clampMaxFollowUps(9), 3);
  assert.equal(clampMaxFollowUps(2), 2);
  assert.equal(clampDayGap(0), 1);
  assert.equal(clampDayGap(7), 7);
});

test("steps advance, then repeat the last one rather than sending blank", () => {
  assert.equal(followUpStepIndex(rec({ count: 1 })), 0);
  assert.equal(followUpStepIndex(rec({ count: 2 })), 1);
  const steps = ["first", "second"];
  assert.equal(stepAt(steps, 0), "first");
  assert.equal(stepAt(steps, 1), "second");
  assert.equal(stepAt(steps, 2), "second");
  assert.equal(stepAt([], 0), undefined);
});

test("a blank follow-up subject replies to the last one, without stacking Re:", () => {
  assert.equal(followUpSubject("", "Quick question"), "Re: Quick question");
  assert.equal(followUpSubject("", "Re: Quick question"), "Re: Quick question");
  assert.equal(followUpSubject("  ", "RE: hello"), "RE: hello");
  assert.equal(followUpSubject("New angle", "Quick question"), "New angle");
  assert.equal(followUpSubject("", ""), "");
});

test("a sent status is matched against the campaign's own word, not \"Sent\"", () => {
  // The bug this replaces: a hardcoded "Sent" counted a campaign whose word is
  // "Done" as zero contacted, which silently emptied the contact rate, the reply
  // rate and every cost-per-lead figure derived from them.
  assert.equal(isSentStatus("Done", "Done"), true);
  assert.equal(isSentStatus("Έγινε", "Έγινε"), true);
  assert.equal(isSentStatus("Sent", "Done"), false);
  assert.equal(isSentStatus("done", "Done"), true);
  assert.equal(isSentStatus("  Done  ", "Done"), true);
  // An unset sentValue falls back to the historic default.
  assert.equal(isSentStatus("Sent", ""), true);
  assert.equal(DEFAULT_SENT_VALUE, "Sent");
});

test("the follow-up suffix still reads as sent, a longer word does not", () => {
  assert.equal(isSentStatus("Sent +1", "Sent"), true);
  assert.equal(isSentStatus("Sent+2", "Sent"), true);
  // Must not match by prefix alone, or "Sentinel" would count as a send.
  assert.equal(isSentStatus("Sentinel", "Sent"), false);
  assert.equal(isSentStatus("", "Sent"), false);
  assert.equal(isSentStatus("Sending 2026-08-13T10:00:00Z", "Sent"), false);
  assert.equal(isSentStatus("Error", "Sent"), false);
});

test("only a real send with no inbound reply is a follow-up candidate", () => {
  const facts = (over = {}) => ({
    emails: ["a@x.com"],
    status: "Sent",
    inboundValue: "",
    sentValue: "Sent",
    ...over,
  });
  assert.equal(isFollowUpCandidate(facts()), true);
  // The inbound check is the whole reason automated follow-ups are safe: it is
  // what stops a second email going to somebody who replied or bounced.
  assert.equal(isFollowUpCandidate(facts({ inboundValue: "replied" })), false);
  assert.equal(isFollowUpCandidate(facts({ inboundValue: "  " })), true);
  assert.equal(isFollowUpCandidate(facts({ emails: [] })), false);
  // Mid-flight and errored rows are not chased.
  assert.equal(isFollowUpCandidate(facts({ status: "Sending 2026-08-13T10:00:00Z" })), false);
  assert.equal(isFollowUpCandidate(facts({ status: "Error" })), false);
  assert.equal(isFollowUpCandidate(facts({ status: "" })), false);
  // A row already followed up once is still a candidate for the next step.
  assert.equal(isFollowUpCandidate(facts({ status: "Sent +1" })), true);
});
