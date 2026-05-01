"use client";
import { signOut } from "next-auth/react";
import { useEffect, useRef } from "react";

const IDLE_MS = 30 * 60 * 1000;

export function InactivityGuard() {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  //TODO : provide initial value to timer ref to avoid potential undefined issues, or add a check before clearing timeout in reset function.

  const reset = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => signOut({ callbackUrl: "/login" }), IDLE_MS);
  };

  useEffect(() => {
    ["mousemove", "keydown", "click", "touchstart"].forEach((e) =>
      window.addEventListener(e, reset),
    );
    reset();
    return () => {
      clearTimeout(timer.current);
      ["mousemove", "keydown", "click", "touchstart"].forEach((e) =>
        window.removeEventListener(e, reset),
      );
    };
  }, []);

  return null;
}