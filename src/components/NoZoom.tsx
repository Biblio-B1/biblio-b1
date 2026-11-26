"use client";

// Téléphone : la page ne se zoome ni ne se dézoome (ni pincement, ni double tap). Safari sur iPhone
// ignore « user-scalable=no » : on bloque aussi ses gestes de pincement ici. Les PDF gardent leurs
// boutons de zoom.
import { useEffect } from "react";

export function NoZoom() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    // Deux doigts qui bougent = pincement.
    const pinch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.addEventListener("gesturestart", stop, { passive: false });
    document.addEventListener("gesturechange", stop, { passive: false });
    document.addEventListener("gestureend", stop, { passive: false });
    document.addEventListener("touchmove", pinch, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
      document.removeEventListener("touchmove", pinch);
    };
  }, []);
  return null;
}
