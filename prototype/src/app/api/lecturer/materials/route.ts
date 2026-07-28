import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const materials = await prisma.material.findMany({
      where: { lecturerId: session.user.id },
      include: { course: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      materials.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        courseId: m.courseId,
        courseName: m.course.title,
        filePath: m.filePath,
        fileName: m.fileName,
        fileSize: m.fileSize,
        uploadedAt: m.createdAt,
      }))
    );
  } catch (error) {
    console.error('Materials GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'lecturer') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const courseId = formData.get('courseId') as string;
    const file = formData.get('file') as File;

    if (!title || !courseId || !file) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify course exists
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Save file
    const buffer = await file.arrayBuffer();
    const filename = `${Date.now()}-${file.name}`;
    const filepath = join(process.cwd(), 'public/uploads/materials', filename);
    writeFileSync(filepath, Buffer.from(buffer));

    // Create material record
    const material = await prisma.material.create({
      data: {
        title,
        description,
        courseId,
        lecturerId: session.user.id,
        fileName: file.name,
        filePath: `/uploads/materials/${filename}`,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
      },
      include: { course: true },
    });

    return NextResponse.json({
      id: material.id,
      title: material.title,
      description: material.description,
      courseId: material.courseId,
      courseName: material.course.title,
      filePath: material.filePath,
      fileName: material.fileName,
      fileSize: material.fileSize,
      uploadedAt: material.createdAt,
    });
  } catch (error) {
    console.error('Materials POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
