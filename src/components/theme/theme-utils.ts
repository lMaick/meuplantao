export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;

export const THEME_STORAGE_KEY = "meuplantao:theme";

export const themeOptions: Array<{
  value: Theme;
  label: string;
}> = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

export function getResolvedTheme(theme: Theme, systemTheme: ResolvedTheme): ResolvedTheme {
  return theme === "system" ? systemTheme : theme;
}

export function getNextTheme(theme: Theme): Theme {
  const currentIndex = themeOptions.findIndex((option) => option.value === theme);
  return themeOptions[(currentIndex + 1) % themeOptions.length]?.value ?? "system";
}
