const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p'

export function imageUrl(
  path: string | null | undefined,
  size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original' = 'w500',
) {
  return path ? `${IMAGE_BASE_URL}/${size}${path}` : null
}

export const posterUrl = (path: string | null | undefined) => imageUrl(path, 'w500')
export const backdropUrl = (path: string | null | undefined) => imageUrl(path, 'w1280')
// Lets phones pick the 780px backdrop instead of always decoding the 1280px one.
export const backdropSrcSet = (path: string | null | undefined) =>
  path ? `${imageUrl(path, 'w780')} 780w, ${imageUrl(path, 'w1280')} 1280w` : undefined
export const profileUrl = (path: string | null | undefined) => imageUrl(path, 'w185')
export const providerLogoUrl = (path: string | null | undefined) => imageUrl(path, 'w185')
