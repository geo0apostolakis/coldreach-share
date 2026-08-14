import { NextResponse } from "next/server";
import { listModels } from "@/lib/ai";

export const revalidate = 3600;

export async function GET() {
  return NextResponse.json({ models: await listModels() });
}
