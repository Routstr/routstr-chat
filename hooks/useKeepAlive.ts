"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { withBase } from "@/lib/base";

/**
 * Hook that plays silent audio to keep the PWA active when the screen is off.
 * This prevents mobile browsers from suspending the app during streaming responses.
 *
 * Uses an HTML audio element with Media Session API to:
 * 1. Keep the app active in background
 * 2. Show media controls on lock screen (like music apps)
 *
 * iOS Safari specific requirements:
 * - Audio must be 5+ seconds for lock screen controls
 * - audioSession.type must be "playback" (iOS 17+)
 * - playbackState must be explicitly set
 *
 * @param enabled Whether the keep-alive feature is enabled (defaults to false)
 */
export function useKeepAlive(enabled: boolean = false) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  // Create a silent audio blob URL (10 seconds of silence as WAV for better iOS compatibility)
  const createSilentAudioUrl = useCallback(() => {
    // Create a 10-second silent WAV file programmatically
    // WAV format has better iOS Safari compatibility than MP3
    const sampleRate = 8000; // Low sample rate to minimize size
    const duration = 10; // 10 seconds (iOS needs 5+ for lock screen)
    const numChannels = 1;
    const bitsPerSample = 8;
    const numSamples = sampleRate * duration;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = numSamples * blockAlign;
    const fileSize = 44 + dataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, fileSize - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    // Fill with silence (128 for 8-bit audio = silence)
    for (let i = 44; i < fileSize; i++) {
      view.setUint8(i, 128);
    }

    const blob = new Blob([buffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    // Store for cleanup
    blobUrlRef.current = url;
    return url;
  }, []);

  // Setup Media Session metadata for lock screen
  const setupMediaSession = useCallback(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Routstr Chat Active",
        artist: "Background processing...",
        album: "Routstr",
        artwork: [
          {
            src: withBase("/icons/icon-192.png"),
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: withBase("/icons/icon-512.png"),
            sizes: "512x512",
            type: "image/png",
          },
        ],
      });

      // Set playback state explicitly (required for iOS)
      navigator.mediaSession.playbackState = "playing";

      // Handle media session actions
      navigator.mediaSession.setActionHandler("play", () => {
        audioRef.current?.play();
        navigator.mediaSession.playbackState = "playing";
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audioRef.current?.pause();
        navigator.mediaSession.playbackState = "paused";
      });
      // Disable skip actions
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    }
  }, []);

  // Set audio session type for iOS 17+ (allows playback with ringer off)
  const setupAudioSession = useCallback(() => {
    const nav = navigator as Navigator & {
      audioSession?: { type: string };
    };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = "playback";
      } catch (e) {
        console.warn("[useKeepAlive] Failed to set audioSession type:", e);
      }
    }
  }, []);

  // Start silent audio playback with lock screen controls
  const start = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      return; // Already playing
    }

    try {
      // Setup audio session first (iOS 17+)
      setupAudioSession();

      if (!audioRef.current) {
        const audio = new Audio();
        audio.src = createSilentAudioUrl();
        audio.loop = true;
        // Volume must be > 0 for iOS to show lock screen controls
        // 0.01 is barely audible
        audio.volume = 0.01;
        // Prevent audio from being muted (iOS requirement)
        audio.muted = false;
        audioRef.current = audio;
      }

      audioRef.current
        .play()
        .then(() => {
          setupMediaSession();
          setIsActive(true);
        })
        .catch((error) => {
          console.warn("[useKeepAlive] Failed to start audio:", error);
          setIsSupported(false);
        });
    } catch (error) {
      console.warn("[useKeepAlive] Failed to initialize audio:", error);
      setIsSupported(false);
    }
  }, [createSilentAudioUrl, setupMediaSession, setupAudioSession]);

  // Stop silent audio playback
  const stop = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }

      // Clear media session
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      }

      // Revoke blob URL to prevent memory leak
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      setIsActive(false);
    } catch (error) {
      console.warn("[useKeepAlive] Failed to stop audio:", error);
    }
  }, []);

  // Auto-start on first user interaction (required by mobile browsers)
  // Only if enabled is true; whoever turns it off calls stop()
  useEffect(() => {
    if (!enabled) return;

    const handleInteraction = () => {
      start();
      // Remove listeners after first interaction
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
      document.removeEventListener("keydown", handleInteraction);
    };

    document.addEventListener("click", handleInteraction);
    document.addEventListener("touchstart", handleInteraction);
    document.addEventListener("keydown", handleInteraction);

    return () => {
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
      document.removeEventListener("keydown", handleInteraction);
    };
  }, [enabled, start]);

  // Handle visibility changes - resume audio when app becomes visible
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (!document.hidden && audioRef.current?.paused && isActive) {
        audioRef.current.play().catch(() => {});
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "playing";
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isActive,
    isSupported,
    start,
    stop,
  };
}
