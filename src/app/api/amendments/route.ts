import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const completed = searchParams.get("completed");
    const showCompleted = completed === "true";

    const amendments = await prisma.amendmentQueueItem.findMany({
      where: {
        isCompleted: showCompleted,
      },
      include: {
        customer: true,
      },
      orderBy: showCompleted
        ? { completedAt: "desc" }
        : { actionByDate: "asc" },
    });

    return NextResponse.json(amendments);
  } catch (error) {
    console.error("Error fetching amendments:", error);
    return NextResponse.json(
      { error: "Failed to fetch amendments" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, isCompleted } = body;

    if (!id || isCompleted === undefined) {
      return NextResponse.json(
        { error: "id and isCompleted are required" },
        { status: 400 }
      );
    }

    const amendment = await prisma.amendmentQueueItem.update({
      where: { id },
      data: {
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
      },
      include: {
        customer: true,
      },
    });

    return NextResponse.json(amendment);
  } catch (error) {
    console.error("Error updating amendment:", error);
    return NextResponse.json(
      { error: "Failed to update amendment" },
      { status: 500 }
    );
  }
}
