"use client";

import { useParams } from "next/navigation";
import { EditorShell } from "@/components/clip/editor/editor-shell";

export default function EditClipPage() {
  const { jobId, clipId } = useParams<{ jobId: string; clipId: string }>();
  return <EditorShell jobId={jobId} clipId={clipId} />;
}
