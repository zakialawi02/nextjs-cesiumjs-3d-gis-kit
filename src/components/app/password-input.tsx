"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { TextInput } from "@/components/app/form-fields";

/**
 * Password field with the eye toggle of the guest pages (togglePassword() in layouts/guest.blade.php).
 * A Client Component: render it from client forms, since its `icon` is a Lucide component.
 */
export function PasswordInput(props: Omit<ComponentProps<typeof TextInput>, "type" | "children">) {
  const [visible, setVisible] = useState(false);

  return (
    <TextInput {...props} type={visible ? "text" : "password"}>
      <button
        className="absolute right-3 flex items-center text-base-content-muted transition-colors duration-200 hover:text-primary"
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? (
          <Eye className="size-[1.1rem]" aria-hidden="true" />
        ) : (
          <EyeOff className="size-[1.1rem]" aria-hidden="true" />
        )}
      </button>
    </TextInput>
  );
}
