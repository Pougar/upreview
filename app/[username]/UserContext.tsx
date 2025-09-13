"use client";

import { createContext, useContext } from "react";

interface UserContextValue {
  username: string;
}

const UserContext = createContext<UserContextValue | null>(null);

export const UserProvider = UserContext.Provider;

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within a UserProvider");
  return context;
};