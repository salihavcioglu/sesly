export function shouldOpenDevTools(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.SESLY_OPEN_DEVTOOLS === '1';
}
