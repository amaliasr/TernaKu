"use client";

import { useState } from "react";
import type { User } from "@/lib/types";
import styles from "./Avatar.module.css";

export default function Avatar({
  user,
  size = "md",
  className = "",
}: {
  user: Pick<User, "name" | "photo">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
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
      {user.photo && failedPhoto !== user.photo ? (
        <img
          src={user.photo}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedPhoto(user.photo || null)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
