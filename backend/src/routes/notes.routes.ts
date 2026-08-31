import { Router } from "express";
import { getNote, listNotes } from "@/controllers/notes.controller";
import { requireUser } from "@/middleware/auth";

export const notesRouter: Router = Router();

notesRouter.get("/", requireUser, listNotes);
notesRouter.get("/:id", requireUser, getNote);
