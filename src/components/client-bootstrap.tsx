"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import {
  escapeHtml,
  formatIndonesianCoordinate,
  formatNumber,
  matchMonthYear,
  parseTimestamp,
  safeColor,
} from "@/lib/client/helpers";
import { getPopupAlert } from "@/lib/client/popup-alert";
import { MyZkToast, type ToastType } from "@/lib/client/toast";

const FLASH_COOKIE = "flash";

function readFlash(): { type: ToastType; message: string } | null {
  const raw = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${FLASH_COOKIE}=`))
    ?.slice(FLASH_COOKIE.length + 1);
  if (!raw) return null;
  document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return typeof parsed?.message === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Installs the browser globals the ported vanilla scripts rely on (window.escapeHtml,
 * window.MyZkToast, window.ZkPopAlert, ...) and shows flash toasts set by Server Actions.
 */
export function ClientBootstrap() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    Object.assign(window, {
      escapeHtml,
      safeColor,
      parseTimestamp,
      matchMonthYear,
      formatIndonesianCoordinate,
      formatNumber,
      MyZkToast,
    });
    Object.defineProperty(window, "ZkPopAlert", {
      configurable: true,
      get: getPopupAlert,
    });
  }, []);

  useEffect(() => {
    const flash = readFlash();
    if (flash) MyZkToast.show(flash.message, flash.type);
  }, [pathname, searchParams]);

  return null;
}
