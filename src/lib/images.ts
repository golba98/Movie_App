const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p'

export type ImageSize = 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original'

type ImagePath = string | null | undefined

export function imageUrl(path: ImagePath, size: ImageSize = 'w500') {
  return path ? `${IMAGE_BASE_URL}/${size}${path}` : null
}

export const backdropUrl = (path: ImagePath) => imageUrl(path, 'w1280')
// Lets phones pick the 780px backdrop instead of always decoding the 1280px one.
export const backdropSrcSet = (path: ImagePath) =>
  path ? `${imageUrl(path, 'w780')} 780w, ${imageUrl(path, 'w1280')} 1280w` : undefined
export const profileUrl = (path: ImagePath) => imageUrl(path, 'w185')
export const providerLogoUrl = (path: ImagePath) => imageUrl(path, 'w185')
