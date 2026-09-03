"use client";
import { useEffect, useState } from "react";
export function Avatar({
  name,
  image,
}: {
  name?: string | null;
  image?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  return (
    <span className="avatar overflow-hidden" aria-label={name || "Account"}>
      {image?.startsWith("https://") && !failed ? (
        <img
          src={image}
          alt=""
          width={36}
          height={36}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        (name || "User")
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
          .toUpperCase()
      )}
    </span>
  );
}
