"use client";

import { useState } from "react";
import type { User } from "@/lib/types";
import styles from "./Avatar.module.css";
import { usePhoto } from "./usePhoto";

export default function Avatar({
  user,
  size = "md",
  className = "",
}: {
  user: Pick<User, "name" | "photo" | "photo_ref">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const { src } = usePhoto(user.photo, user.photo_ref);
  const initials =
    user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0] || "")
      .join("")
      .toLocaleUpperCase("id-ID") || "?";
  return (
    <span
      className={`${styles.avatar} ${styles[size]} ${className}`}
      role="img"
      aria-label={`Foto profil ${user.name}`}
    >
      {src && failedPhoto !== src ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedPhoto(src)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
