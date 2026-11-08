import { createContext, useContext } from "react";
import type { Application, Category } from "../lib";

export interface ApplicationActions {
  edit: (app: Application) => void;
  duplicate: (app: Application) => void;
  remove: (app: Application) => void;
  toggleFavorite: (app: Application) => void;
  move: (app: Application, offset: number) => void;
  moveToCategory: (app: Application, categoryId: number) => void;
}
export interface CategoryActions {
  toggle: (category: Category) => void;
  edit: (category: Category) => void;
  remove: (category: Category) => void;
  move: (category: Category, offset: number) => void;
  addApplication: (category: Category) => void;
}
/** Dashboard state shared by category sections and cards. */
export interface DashboardState {
  busy: boolean;
  organizing: boolean;
  descriptions: boolean;
  categories: Category[];
  applications: ApplicationActions;
  categoryActions: CategoryActions;
}

export const DashboardContext = createContext<DashboardState | null>(null);

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard must be used inside Dashboard");
  return value;
}
