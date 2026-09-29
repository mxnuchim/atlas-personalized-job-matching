"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { avatarFor } from "@/lib/avatars";

import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export type PickerUser = { id: string; email: string; name: string | null; image: string | null };

/**
 * Sign in by picking your face, then typing your password.
 *
 * The picker only saves you typing an address — the password is still required, so
 * this is a convenience, not a weaker door. It does disclose who has an account to
 * anyone who loads the page; that is inherent to a picker, and no more than an
 * enumerable login form already leaks.
 *
 * With no accounts, or when you want one that is not shown, it falls back to the
 * ordinary email-and-password form.
 */
export function LoginForm({ users }: { users: PickerUser[] }) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [chosen, setChosen] = useState<PickerUser | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Choosing a face is only half the action; landing the cursor in the field that
  // finishes it is what makes it feel like one step rather than two.
  useEffect(() => {
    if (chosen) passwordRef.current?.focus();
  }, [chosen]);

  if (users.length > 0 && !chosen) {
    return (
      <div className="space-y-5">
        <ul className="flex flex-wrap justify-center gap-5">
          {users.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => setChosen(user)}
                className="focus-visible:ring-ring group flex w-24 flex-col items-center gap-2 rounded-xl p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <Avatar
                  name={user.name}
                  email={user.email}
                  image={user.image ?? avatarFor(user.email)}
                  size={64}
                  className="ring-border ring-2 transition-transform group-hover:scale-105 group-focus-visible:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
                <span className="w-full truncate text-center text-sm font-medium">
                  {user.name ?? user.email.split("@")[0]}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setChosen({ id: "", email: "", name: null, image: null })}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mx-auto block rounded text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Use a different account
        </button>
      </div>
    );
  }

  const picked = chosen?.email ? chosen : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {picked ? (
        <div className="flex items-center gap-3 pb-1">
          <Avatar
            name={picked.name}
            email={picked.email}
            image={picked.image ?? avatarFor(picked.email)}
            size={40}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{picked.name ?? picked.email}</p>
            <p className="text-muted-foreground truncate text-xs">{picked.email}</p>
          </div>
          <input type="hidden" name="email" value={picked.email} />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            aria-invalid={state.error ? true : undefined}
            className="h-10"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
          className="h-10"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="h-10 w-full"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      {users.length > 0 ? (
        <button
          type="button"
          onClick={() => setChosen(null)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mx-auto flex items-center gap-1.5 rounded text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to accounts
        </button>
      ) : null}
    </form>
  );
}
