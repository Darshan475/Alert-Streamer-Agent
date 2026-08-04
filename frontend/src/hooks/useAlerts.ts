"use client";

import useSWR from "swr";
import { getHealth } from "@/lib/api";

const fetcherHealth = () => getHealth();

export function useHealth() {
  return useSWR("health", fetcherHealth, { revalidateOnFocus: false });
}
