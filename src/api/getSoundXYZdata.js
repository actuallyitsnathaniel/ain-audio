import { sound_xyz_url, sound_xyz_key } from "./util";

const rileyXYZId = "a3c5a81e-f15e-4300-a4f3-ae03846e60a9";

const query = `
query AllArtistReleases {
    artist(id: "${rileyXYZId}") {
      id
      user {
        id
      }
      numReleases(filter: {
        releaseAuthor: ALL,
        creditSplit: ALL,
        releaseAlbumRevealStatus: ALL
      })
      releases(pagination: {
        first: 20
      }, filter: {
        releaseAuthor: ALL,
        creditSplit: ALL,
        releaseAlbumRevealStatus: ALL
      }) {
        edges {
          node {
            title
            id
            artist {
              name
              id
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const getSoundXYZSongs = await fetch(sound_xyz_url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Sound-Client-Key": sound_xyz_key,
  },
  body: JSON.stringify({ query }),
})
  .then((response) => response.json())
  .then((data) => {
    let releases = data.data.artist.releases.edges;
    return releases;
  })
  .catch((error) => console.error("Error:", error));

export const soundXyzReleases = getSoundXYZSongs;
