"use client";

import { AlertStreamProvider } from "@/contexts/AlertStreamContext";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <AlertStreamProvider>{children}</AlertStreamProvider>;
}
