import type { Metadata } from "next";

import { FacialMotionLab } from "@/components/studio/FacialMotionLab";
import "./face-motion-lab.css";

export const metadata: Metadata = {
  title: "Facial Motion Lab · Gal Story Studio",
  description: "Galgame 立绘独立眼嘴、语音口型、自然眨眼与表情切换实验台。",
};

export default function FaceMotionLabPage() {
  return <FacialMotionLab />;
}
