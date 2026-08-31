import type { Request, Response } from "express";
import type { NoteDto } from "@study-loop/shared";
import { Note } from "@/models/Note";
import { asyncHandler } from "@/utils/async-handler";
import { badRequest, notFound } from "@/utils/errors";
import mongoose from "mongoose";
const { isValidObjectId } = mongoose;

export const listNotes = asyncHandler(async (_req: Request, res: Response) => {
  // Body is deliberately excluded -- the index only needs titles.
  const notes = await Note.find({}, { subject: 1, title: 1 }).sort({ createdAt: 1 }).lean();
  res.json(notes.map((n) => ({ id: String(n._id), subject: n.subject, title: n.title })));
});

export const getNote = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id || !isValidObjectId(id)) throw badRequest("That note id is not valid.");

  const note = await Note.findById(id).lean();
  if (!note) throw notFound("Note");

  const dto: NoteDto = {
    id: String(note._id),
    subject: note.subject,
    title: note.title,
    bodyMd: note.bodyMd,
    concepts: note.concepts.map((c) => ({
      slug: c.slug,
      label: c.label,
      summary: c.summary,
      chunkOrdinals: c.chunkOrdinals,
    })),
  };

  res.json(dto);
});
