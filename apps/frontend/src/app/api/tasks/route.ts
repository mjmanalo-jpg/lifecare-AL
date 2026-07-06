import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();

// Validation schemas
const CreateTaskSchema = z.object({
  residentId: z.string().uuid("Invalid resident ID"),
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(1000).optional(),
  status: z
    .enum(["pending", "in-progress", "completed", "cancelled"])
    .default("pending"),
  assignedTo: z.string().optional(),
  dueAt: z.string().datetime().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(255).optional(),
  description: z.string().max(1000).optional(),
  status: z
    .enum(["pending", "in-progress", "completed", "cancelled"])
    .optional(),
  assignedTo: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

const QueryParamsSchema = z.object({
  residentId: z.string().uuid().optional(),
  status: z.string().optional(),
  skip: z.coerce.number().int().nonnegative().default(0),
  take: z.coerce.number().int().positive().max(100).default(20),
});

type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
type QueryParams = z.infer<typeof QueryParamsSchema>;

async function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): Promise<{ valid: true; data: T } | { valid: false; error: string }> {
  try {
    const validated = schema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, error: error.errors[0].message };
    }
    return { valid: false, error: "Validation failed" };
  }
}

function handleError(error: unknown, context: string): NextResponse {
  console.error(`[${context}]`, error);

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Validation error", details: error.errors },
      { status: 400 }
    );
  }

  if (
    error instanceof Error &&
    error.message.includes("not found")
  ) {
    return NextResponse.json(
      { error: "Resource not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const queryData = {
      residentId: searchParams.get("residentId"),
      status: searchParams.get("status"),
      skip: searchParams.get("skip"),
      take: searchParams.get("take"),
    };

    const validation = await validateRequest(QueryParamsSchema, queryData);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { residentId, status, skip, take } = validation.data;

    const where: {
      residentId?: string;
      status?: string;
    } = {};

    if (residentId) {
      where.residentId = residentId;
    }
    if (status) {
      where.status = status;
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.task.count({ where }),
    ]);

    return NextResponse.json(
      {
        data: tasks,
        pagination: {
          total,
          skip,
          take,
          hasMore: skip + take < total,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error, "GET /api/tasks");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const validation = await validateRequest(CreateTaskSchema, body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { residentId, title, description, status, assignedTo, dueAt } =
      validation.data;

    // Verify resident exists
    const resident = await prisma.resident.findUnique({
      where: { id: residentId },
    });

    if (!resident) {
      return NextResponse.json(
        { error: "Resident not found" },
        { status: 404 }
      );
    }

    const task = await prisma.task.create({
      data: {
        residentId,
        title,
        description,
        status,
        assignedTo,
        dueAt: dueAt ? new Date(dueAt) : null,
      },
    });

    return NextResponse.json({ data: task }, { status: 201 });
  } catch (error) {
    return handleError(error, "POST /api/tasks");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const taskId = searchParams.get("id");

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();

    const validation = await validateRequest(UpdateTaskSchema, body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Verify task exists
    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!existingTask) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    const updateData: {
      title?: string;
      description?: string | null;
      status?: string;
      assignedTo?: string | null;
      dueAt?: Date | null;
      completedAt?: Date | null;
    } = {};

    const { title, description, status, assignedTo, dueAt, completedAt } =
      validation.data;

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description || null;
    if (status !== undefined) updateData.status = status;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo || null;
    if (dueAt !== undefined) updateData.dueAt = dueAt ? new Date(dueAt) : null;
    if (completedAt !== undefined) {
      updateData.completedAt = completedAt ? new Date(completedAt) : null;
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });

    return NextResponse.json({ data: updatedTask }, { status: 200 });
  } catch (error) {
    return handleError(error, "PUT /api/tasks");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const taskId = searchParams.get("id");

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 }
      );
    }

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    await prisma.task.delete({
      where: { id: taskId },
    });

    return NextResponse.json(
      { message: "Task deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error, "DELETE /api/tasks");
  }
}
