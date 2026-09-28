/** Title details open as a modal over whichever page they were opened from. */
export function isDetailsPath(pathname: string) {
  return pathname.startsWith('/movie/') || pathname.startsWith('/tv/')
}
