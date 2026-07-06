import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const where: any = {};
    if (from) where.from = from;
    if (to) where.to = to;

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(messages);
  } catch (err: any) {
    console.error("[GET /api/messages]", err?.message);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { from, to, text } = await req.json();

    if (!from || !to || !text) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const message = await prisma.message.create({
      data: { from, to, text },
    });

    return NextResponse.json(message, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/messages]", err?.message);
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }
}
