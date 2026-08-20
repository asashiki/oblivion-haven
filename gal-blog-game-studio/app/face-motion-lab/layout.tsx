import type { Metadata } from "next";
import "./face-motion-lab.css";

export const metadata: Metadata = {
  title: "面部动效实验室 · Gal Blog Game Studio",
  description: "在 Studio 内测试语音口型、持续眨眼、表情切换与立绘演出。",
};

export default function FaceMotionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
