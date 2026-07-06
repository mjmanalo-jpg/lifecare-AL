import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface MedicationPayload {
  residentId: string;
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  status?: string;
  startDate: string | Date;
  endDate?: string | Date | null;
  prescribedBy?: string;
  reason?: string;
  sideEffects?: string;
  contraindications?: string;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

function validateMedicationPayload(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.residentId || typeof data.residentId !== 'string') {
    errors.push('residentId is required and must be a string');
  }

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.push('name is required and must be a non-empty string');
  }

  if (!data.dosage || typeof data.dosage !== 'string' || data.dosage.trim().length === 0) {
    errors.push('dosage is required and must be a non-empty string');
  }

  if (!data.frequency || typeof data.frequency !== 'string' || data.frequency.trim().length === 0) {
    errors.push('frequency is required and must be a non-empty string');
  }

  if (!data.route || typeof data.route !== 'string' || data.route.trim().length === 0) {
    errors.push('route is required and must be a non-empty string');
  }

  if (!data.startDate) {
    errors.push('startDate is required');
  } else {
    try {
      new Date(data.startDate);
    } catch {
      errors.push('startDate must be a valid date');
    }
  }

  if (data.endDate) {
    try {
      new Date(data.endDate);
    } catch {
      errors.push('endDate must be a valid date if provided');
    }
  }

  const validStatuses = ['ACTIVE', 'PENDING', 'VERIFIED', 'DISCONTINUED', 'HOLD'];
  if (data.status && !validStatuses.includes(data.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

function formatMedicationResponse(medication: any) {
  return {
    id: medication.id,
    residentId: medication.residentId,
    name: medication.name,
    dosage: medication.dosage,
    frequency: medication.frequency,
    route: medication.route,
    status: medication.status,
    startDate: medication.startDate.toISOString(),
    endDate: medication.endDate ? medication.endDate.toISOString() : null,
    prescribedBy: medication.prescribedBy || null,
    reason: medication.reason || null,
    sideEffects: medication.sideEffects || null,
    contraindications: medication.contraindications || null,
    createdAt: medication.createdAt.toISOString(),
    updatedAt: medication.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse<any>> {
  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get('residentId');
    const status = searchParams.get('status');
    const skip = Math.max(0, parseInt(searchParams.get('skip') || '0', 10));
    const take = Math.min(100, Math.max(1, parseInt(searchParams.get('take') || '10', 10)));

    const whereCondition: Prisma.MedicationWhereInput = {};

    if (residentId) {
      if (typeof residentId !== 'string') {
        return NextResponse.json(
          { error: 'residentId must be a string' } as ErrorResponse,
          { status: 400 }
        );
      }
      whereCondition.residentId = residentId;
    }

    if (status) {
      const validStatuses = ['ACTIVE', 'PENDING', 'VERIFIED', 'DISCONTINUED', 'HOLD'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          {
            error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          } as ErrorResponse,
          { status: 400 }
        );
      }
      whereCondition.status = status;
    }

    const [medications, total] = await Promise.all([
      prisma.medication.findMany({
        where: whereCondition,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.medication.count({ where: whereCondition }),
    ]);

    return NextResponse.json(
      {
        data: medications.map(formatMedicationResponse),
        pagination: {
          skip,
          take,
          total,
          hasMore: skip + take < total,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[GET /api/medications]', error);
    return NextResponse.json(
      { error: 'Failed to fetch medications' } as ErrorResponse,
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<any>> {
  try {
    const body = await req.json() as MedicationPayload;

    const validation = validateMedicationPayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.errors.join('; ') } as ErrorResponse,
        { status: 400 }
      );
    }

    const residentExists = await prisma.resident.findUnique({
      where: { id: body.residentId },
      select: { id: true },
    });

    if (!residentExists) {
      return NextResponse.json(
        { error: `Resident with ID ${body.residentId} not found` } as ErrorResponse,
        { status: 404 }
      );
    }

    const medication = await prisma.medication.create({
      data: {
        residentId: body.residentId,
        name: body.name.trim(),
        dosage: body.dosage.trim(),
        frequency: body.frequency.trim(),
        route: body.route.trim(),
        status: body.status || 'PENDING',
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        prescribedBy: body.prescribedBy?.trim() || null,
        reason: body.reason?.trim() || null,
        sideEffects: body.sideEffects?.trim() || null,
        contraindications: body.contraindications?.trim() || null,
      },
    });

    return NextResponse.json(
      { data: formatMedicationResponse(medication) },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/medications]', error);

    if (error instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json(
        { error: 'Invalid medication data', details: error.message } as ErrorResponse,
        { status: 400 }
      );
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' } as ErrorResponse,
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create medication' } as ErrorResponse,
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse<any>> {
  try {
    const body = await req.json() as Partial<MedicationPayload> & { id: string };

    const { id } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'id is required in the request body' } as ErrorResponse,
        { status: 400 }
      );
    }

    const existingMedication = await prisma.medication.findUnique({
      where: { id },
    });

    if (!existingMedication) {
      return NextResponse.json(
        { error: `Medication with ID ${id} not found` } as ErrorResponse,
        { status: 404 }
      );
    }

    const updateData: Prisma.MedicationUpdateInput = {};

    if (body.residentId !== undefined) {
      const residentExists = await prisma.resident.findUnique({
        where: { id: body.residentId },
        select: { id: true },
      });

      if (!residentExists) {
        return NextResponse.json(
          { error: `Resident with ID ${body.residentId} not found` } as ErrorResponse,
          { status: 404 }
        );
      }
      updateData.residentId = body.residentId;
    }

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'name must be a non-empty string' } as ErrorResponse,
          { status: 400 }
        );
      }
      updateData.name = body.name.trim();
    }

    if (body.dosage !== undefined) {
      if (typeof body.dosage !== 'string' || body.dosage.trim().length === 0) {
        return NextResponse.json(
          { error: 'dosage must be a non-empty string' } as ErrorResponse,
          { status: 400 }
        );
      }
      updateData.dosage = body.dosage.trim();
    }

    if (body.frequency !== undefined) {
      if (typeof body.frequency !== 'string' || body.frequency.trim().length === 0) {
        return NextResponse.json(
          { error: 'frequency must be a non-empty string' } as ErrorResponse,
          { status: 400 }
        );
      }
      updateData.frequency = body.frequency.trim();
    }

    if (body.route !== undefined) {
      if (typeof body.route !== 'string' || body.route.trim().length === 0) {
        return NextResponse.json(
          { error: 'route must be a non-empty string' } as ErrorResponse,
          { status: 400 }
        );
      }
      updateData.route = body.route.trim();
    }

    if (body.status !== undefined) {
      const validStatuses = ['ACTIVE', 'PENDING', 'VERIFIED', 'DISCONTINUED', 'HOLD'];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          {
            error: `status must be one of: ${validStatuses.join(', ')}`,
          } as ErrorResponse,
          { status: 400 }
        );
      }
      updateData.status = body.status;
    }

    if (body.startDate !== undefined) {
      try {
        updateData.startDate = new Date(body.startDate);
      } catch {
        return NextResponse.json(
          { error: 'startDate must be a valid date' } as ErrorResponse,
          { status: 400 }
        );
      }
    }

    if (body.endDate !== undefined) {
      if (body.endDate === null) {
        updateData.endDate = null;
      } else {
        try {
          updateData.endDate = new Date(body.endDate);
        } catch {
          return NextResponse.json(
            { error: 'endDate must be a valid date' } as ErrorResponse,
            { status: 400 }
          );
        }
      }
    }

    if (body.prescribedBy !== undefined) {
      updateData.prescribedBy = body.prescribedBy ? body.prescribedBy.trim() : null;
    }

    if (body.reason !== undefined) {
      updateData.reason = body.reason ? body.reason.trim() : null;
    }

    if (body.sideEffects !== undefined) {
      updateData.sideEffects = body.sideEffects ? body.sideEffects.trim() : null;
    }

    if (body.contraindications !== undefined) {
      updateData.contraindications = body.contraindications ? body.contraindications.trim() : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' } as ErrorResponse,
        { status: 400 }
      );
    }

    const updatedMedication = await prisma.medication.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(
      { data: formatMedicationResponse(updatedMedication) },
      { status: 200 }
    );
  } catch (error) {
    console.error('[PUT /api/medications]', error);

    if (error instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json(
        { error: 'Invalid medication data', details: error.message } as ErrorResponse,
        { status: 400 }
      );
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return NextResponse.json(
          { error: 'Medication not found' } as ErrorResponse,
          { status: 404 }
        );
      }
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' } as ErrorResponse,
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update medication' } as ErrorResponse,
      { status: 500 }
    );
  }
}
