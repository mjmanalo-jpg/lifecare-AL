import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const IncidentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().min(1, 'Description is required'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  residentId: z.string().uuid('Invalid resident ID'),
  location: z.string().optional(),
  reportedBy: z.string().optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional().default('OPEN'),
});

type IncidentInput = z.infer<typeof IncidentSchema>;

interface ErrorResponse {
  error: string;
  details?: string;
}

interface IncidentResponse {
  success: boolean;
  data?: any;
  error?: string;
  errors?: Record<string, string[]>;
}

function validateIncidentData(data: unknown): { valid: true; data: IncidentInput } | { valid: false; errors: Record<string, string[]> } {
  try {
    const validated = IncidentSchema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formattedErrors = error.errors.reduce(
        (acc, err) => {
          const path = err.path.join('.');
          if (!acc[path]) acc[path] = [];
          acc[path].push(err.message);
          return acc;
        },
        {} as Record<string, string[]>
      );
      return { valid: false, errors: formattedErrors };
    }
    return { valid: false, errors: { general: ['Validation error occurred'] } };
  }
}

export async function GET(request: NextRequest): Promise<NextResponse<IncidentResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const residentId = searchParams.get('residentId');
    const status = searchParams.get('status');
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 100;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;

    if (limit < 1 || limit > 500) {
      return NextResponse.json(
        { success: false, error: 'Limit must be between 1 and 500' },
        { status: 400 }
      );
    }

    if (offset < 0) {
      return NextResponse.json(
        { success: false, error: 'Offset must be non-negative' },
        { status: 400 }
      );
    }

    const whereClause: any = {};
    if (residentId) {
      whereClause.residentId = residentId;
    }
    if (status) {
      const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { success: false, error: 'Invalid status value' },
          { status: 400 }
        );
      }
      whereClause.status = status;
    }

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where: whereClause,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          resident: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.incident.count({ where: whereClause }),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: {
          incidents,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/incidents error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch incidents' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<IncidentResponse>> {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const validation = validateIncidentData(body);
    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          errors: validation.errors,
        },
        { status: 422 }
      );
    }

    const { residentId, title, description, severity, location, reportedBy, status } = validation.data;

    const residentExists = await prisma.resident.findUnique({
      where: { id: residentId },
    });

    if (!residentExists) {
      return NextResponse.json(
        { success: false, error: 'Resident not found' },
        { status: 404 }
      );
    }

    const incident = await prisma.incident.create({
      data: {
        title,
        description,
        severity,
        residentId,
        location: location || null,
        reportedBy: reportedBy || null,
        status: status || 'OPEN',
      },
      include: {
        resident: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: incident,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/incidents error:', error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to create incident' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse<IncidentResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const incidentId = searchParams.get('id');

    if (!incidentId) {
      return NextResponse.json(
        { success: false, error: 'Incident ID is required' },
        { status: 400 }
      );
    }

    const incidentIdRegex = /^[a-f0-9-]{36}$/i;
    if (!incidentIdRegex.test(incidentId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid incident ID format' },
        { status: 400 }
      );
    }

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident) {
      return NextResponse.json(
        { success: false, error: 'Incident not found' },
        { status: 404 }
      );
    }

    await prisma.incident.delete({
      where: { id: incidentId },
    });

    return NextResponse.json(
      {
        success: true,
        data: { message: 'Incident deleted successfully', id: incidentId },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('DELETE /api/incidents error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete incident' },
      { status: 500 }
    );
  }
}
