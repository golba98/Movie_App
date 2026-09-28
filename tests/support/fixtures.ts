// Shared TMDB and API fixtures for the end-to-end specs.

export const movie = {
  id: 1,
  title: 'Dune: Part Two',
  overview: 'Paul Atreides unites with Chani and the Fremen while seeking justice for his family.',
  poster_path: '/dune-poster.jpg',
  backdrop_path: '/dune-backdrop.jpg',
  vote_average: 8.3,
  release_date: '2024-02-27',
}

export const movieTwo = {
  id: 2,
  title: 'Arrival',
  overview: 'A linguist works with the military to communicate with visitors from another world.',
  poster_path: null,
  backdrop_path: '/arrival.jpg',
  vote_average: 7.6,
  release_date: '2016-11-10',
}

export const tvShow = {
  id: 10,
  name: 'The Expanse',
  overview: 'Humanity has colonised the solar system and a mystery threatens the peace.',
  poster_path: '/expanse.jpg',
  backdrop_path: '/expanse-backdrop.jpg',
  vote_average: 8.1,
  first_air_date: '2015-12-14',
}

export const tvSeasonOne = {
  id: 101,
  season_number: 1,
  episodes: [
    {
      id: 1001,
      name: 'Dulcinea',
      overview: 'The crew of the Canterbury investigates a distress call.',
      episode_number: 1,
      season_number: 1,
      still_path: '/dulcinea.jpg',
      air_date: '2015-12-14',
    },
    {
      id: 1002,
      name: 'The Big Empty',
      overview: 'The crew struggles to survive in a damaged shuttle.',
      episode_number: 2,
      season_number: 1,
      still_path: null,
      air_date: '2015-12-15',
    },
  ],
}

export const paginated = (results: object[], page = 1, totalPages = 2) => ({
  page,
  results,
  total_pages: totalPages,
  total_results: results.length * totalPages,
})

export const detailsExtras = {
  genres: [
    { id: 878, name: 'Science Fiction' },
    { id: 12, name: 'Adventure' },
  ],
  credits: {
    cast: [
      { id: 101, name: 'Zendaya', character: 'Chani', profile_path: '/zendaya.jpg', order: 0 },
      { id: 102, name: 'Timothée Chalamet', character: 'Paul Atreides', profile_path: null, order: 1 },
    ],
    crew: [{ id: 201, name: 'Denis Villeneuve', job: 'Director', department: 'Directing' }],
  },
  videos: {
    results: [
      { id: 'teaser', key: 'teaser-key', name: 'Teaser', site: 'YouTube', type: 'Teaser', official: true },
      { id: 'trailer', key: 'official-key', name: 'Official Trailer', site: 'YouTube', type: 'Trailer', official: true },
    ],
  },
  similar: paginated([movieTwo], 1, 1),
  'watch/providers': {
    results: {
      ZA: {
        link: 'https://www.themoviedb.org/movie/1/watch?locale=ZA',
        flatrate: [{ provider_id: 8, provider_name: 'Example Stream', logo_path: '/provider.jpg', display_priority: 1 }],
        rent: [{ provider_id: 3, provider_name: 'Example Rentals', logo_path: null, display_priority: 2 }],
      },
    },
  },
}

export const authorisedMediaSources = [
  {
    id: 'movie-1',
    mediaType: 'movie',
    tmdbId: 1,
    seasonNumber: null,
    episodeNumber: null,
    label: 'Test licensed movie',
    sourceUrl: '/test-media/capture-test.mp4',
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
  },
  {
    id: 'tv-10-s1e1',
    mediaType: 'tv',
    tmdbId: 10,
    seasonNumber: 1,
    episodeNumber: 1,
    label: 'Test licensed episode one',
    sourceUrl: '/test-media/capture-test.mp4',
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
  },
  {
    id: 'tv-10-s1e2',
    mediaType: 'tv',
    tmdbId: 10,
    seasonNumber: 1,
    episodeNumber: 2,
    label: 'Test licensed episode two',
    sourceUrl: '/test-media/capture-test.mp4?episode=2',
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
  },
]
