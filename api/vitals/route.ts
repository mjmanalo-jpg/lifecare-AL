import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface CreateVitalsRequest {
  userId: string;
  heartRate?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  temperature?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  timestamp?: string;
}

interface VitalsResponse {
  id?: string;
  userId: string;
  heartRate?: number | null;
  bloodPressureSystolic?: number | null;
  bloodPressureDiastolic?: number | null;
  temperature?: number | null;
  respiratoryRate?: number | null;
  oxygenSaturation?: number | null;
  timestamp: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const validateVitalsData = (data: Partial<CreateVitalsRequest>): { valid: boolean; error?: string } => {
  if (data.heartRate !== undefined) {
    if (typeof data.heartRate !== 'number' || data.heartRate < 0 || data.heartRate > 300) {
      return { valid: false, error: 'heartRate must be a number between 0 and 300' };
    }
  }

  if (data.bloodPressureSystolic !== undefined) {
    if (typeof data.bloodPressureSystolic !== 'number' || data.bloodPressureSystolic < 0 || data.bloodPressureSystolic > 300) {
      return { valid: false, error: 'bloodPressureSystolic must be a number between 0 and 300' };
    }
  }

  if (data.bloodPressureDiastolic !== undefined) {
    if (typeof data.bloodPressureDiastolic !== 'number' || data.bloodPressureDiastolic < 0 || data.bloodPressureDiastolic > 200) {
      return { valid: false, error: 'bloodPressureDiastolic must be a number between 0 and 200' };
    }
  }

  if (data.temperature !== undefined) {
    if (typeof data.temperature !== 'number' || data.temperature < 35 || data.temperature > 43) {
      return { valid: false, error: 'temperature must be a number between 35 and 43 Celsius' };
    }
  }

  if (data.respiratoryRate !== undefined) {
    if (typeof data.respiratoryRate !== 'number' || data.respiratoryRate < 0 || data.respiratoryRate > 100) {
      return { valid: false, error: 'respiratoryRate must be a number between 0 and 100' };
    }
  }

  if (data.oxygenSaturation !== undefined) {
    if (typeof data.oxygenSaturation !== 'number' || data.oxygenSaturation < 0 || data.oxygenSaturation > 100) {
      return { valid: false, error: 'oxygenSaturation must be a number between 0 and 100' };
    }
  }

  if (data.timestamp) {
    const date = new Date(data.timestamp);
    if (isNaN(date.getTime())) {
      return { valid: false, error: 'timestamp must be a valid ISO 8601 date string' };
    }
  }

  return { valid: true };
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

    if (!userId || userId.trim().length === 0) {
      return NextResponse.json(
        { error: 'userId query parameter is required' },
        { status: 400 }
      );
    }

    const [vitals, total] = await Promise.all([
      prisma.vitals.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.vitals.count({ where: { userId } }),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: vitals,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/vitals error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch vitals records' },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: CreateVitalsRequest;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    if (!body.userId || body.userId.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    const validation = validateVitalsData(body);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const createData: Prisma.vitalsCreateInput = {
      userId: body.userId,
      heartRate: body.heartRate,
      bloodPressureSystolic: body.bloodPressureSystolic,
      bloodPressureDiastolic: body.bloodPressureDiastolic,
      temperature: body.temperature,
      respiratoryRate: body.respiratoryRate,
      oxygenSaturation: body.oxygenSaturation,
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
    };

    const vital = await prisma.vitals.create({
      data: createData,
    });

    return NextResponse.json(
      { success: true, data: vital },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json(
          { success: false, error: 'Unique constraint violation' },
          { status: 409 }
        );
      }
      if (error.code === 'P2025') {
        return NextResponse.json(
          { success: false, error: 'Record not found' },
          { status: 404 }
        );
      }
    }

    console.error('POST /api/vitals error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create vitals record' },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
