// ── Discography data (extracted from the ain-audio repo) ─────────────────
// Generated from the prototype js/discography-data.js. Art is imported from
// src/assets so Vite fingerprints + optimizes it.

import art0 from "/src/assets/images/projects/riley/Singles_EPs/with-the-rain.jpeg";
import art1 from "/src/assets/images/projects/riley/Singles_EPs/stars-remix.jpeg";
import art2 from "/src/assets/images/projects/riley/Singles_EPs/i-was-9-remix.png";
import art3 from "/src/assets/images/projects/riley/Singles_EPs/better.jpeg";
import art4 from "/src/assets/images/projects/riley/Singles_EPs/losing-hearts.jpg";
import art5 from "/src/assets/images/projects/sam-denton/LPs/for_now_600x600bb.jpeg";
import art6 from "/src/assets/images/projects/sam-denton/Singles_EPs/dreams_600x600bb.jpeg";
import art7 from "/src/assets/images/projects/sam-denton/Singles_EPs/better_2021_single_600x600bb.jpeg";
import art8 from "/src/assets/images/projects/sam-denton/Singles_EPs/first_600x600bb.jpeg";
import art9 from "/src/assets/images/projects/sam-denton/Singles_EPs/i_just_might_600x600bb.jpeg";
import art10 from "/src/assets/images/projects/sam-denton/Singles_EPs/smoke_in_the_mirror_600x600bb.jpeg";
import art11 from "/src/assets/images/projects/sam-denton/Singles_EPs/2_09_600x600bb.jpeg";
import art12 from "/src/assets/images/projects/sam-denton/Singles_EPs/idkya_600x600bb.jpeg";
import art13 from "/src/assets/images/projects/sam-denton/Singles_EPs/back_to_you_600x600bb.jpeg";
import art14 from "/src/assets/images/projects/ryland/Singles_EPs/gonna-be-fine-1000x1000bb.jpeg";
import art15 from "/src/assets/images/projects/ryland/Singles_EPs/You-Should-Know-EP.jpeg";
import art16 from "/src/assets/images/projects/ryland/LPs/Portrait-LP_600x600bb.jpeg";
import art17 from "/src/assets/images/projects/ryland/Singles_EPs/Talking-Single_600x600bb.jpeg";
import art18 from "/src/assets/images/projects/ryland/Singles_EPs/Karma-Single_600x600bb.jpeg";
import art19 from "/src/assets/images/projects/ryland/Singles_EPs/IveBeenLooking-Single_600x600bb.jpeg";
import art20 from "/src/assets/images/projects/ryland/Singles_EPs/Lashing-Out-EP_600x600bb.jpeg";
import art21 from "/src/assets/images/projects/ryland/Singles_EPs/Stairwell-Single_600x600bb.jpeg";
import art22 from "/src/assets/images/projects/ryland/Singles_EPs/Itinerary-EP_600x600bb.jpeg";
import art23 from "/src/assets/images/projects/aubit-sound/discography/odessa-vol-3.jpg";
import art24 from "/src/assets/images/projects/aubit-sound/discography/garryx-for-serum-vol-1.jpg";
import art25 from "/src/assets/images/projects/aubit-sound/discography/gray-vol-2.jpg";
import art26 from "/src/assets/images/projects/aubit-sound/discography/louv-vol-1.jpg";
import art27 from "/src/assets/images/projects/aubit-sound/discography/plume-vol-1.jpg";
import art28 from "/src/assets/images/projects/aubit-sound/discography/gray-vol-1.jpg";
import art29 from "/src/assets/images/projects/aubit-sound/discography/chain-pop-vol-1.jpg";
import art30 from "/src/assets/images/projects/aubit-sound/discography/snakes-for-serum-vol-1.jpg";
import art31 from "/src/assets/images/projects/aubit-sound/discography/broox-bounce-vol-1.jpg";
import art32 from "/src/assets/images/projects/aubit-sound/discography/masa-vox-chops-vol-1.jpg";
import art33 from "/src/assets/images/projects/aubit-sound/discography/petit-vox-chops-vol-1.jpg";
import art34 from "/src/assets/images/projects/aubit-sound/discography/awake-vol-1.jpg";
import art35 from "/src/assets/images/projects/aubit-sound/discography/1975-for-serum.jpg";
import art36 from "/src/assets/images/projects/aubit-sound/discography/ultrallenium-vox-chops-col-1.jpg";
import art37 from "/src/assets/images/projects/aubit-sound/discography/jacc-for-massive-vol-1.jpg";
import art38 from "/src/assets/images/projects/aubit-sound/discography/odessa-vol-2.jpg";
import art39 from "/src/assets/images/projects/john-white/Singles_EPs/fake_smiles_ep600x600bb.jpeg";
import art40 from "/src/assets/images/projects/john-white/Singles_EPs/stars_remix_600x600bb.jpeg";
import art41 from "/src/assets/images/projects/john-white/Singles_EPs/whoever_you_want_to_be_single_600x600bb.jpeg";
import art42 from "/src/assets/images/projects/john-white/Singles_EPs/better_2021_single_600x600bb.jpeg";
import art43 from "/src/assets/images/projects/brandx/works/norml-spiraling_600x600bb.jpg";
import art44 from "/src/assets/images/projects/brandx/works/toms-diner-cover.png";
import art45 from "/src/assets/images/projects/brandx/works/popfest-vol2-600x600bb.jpg";
import art46 from "/src/assets/images/projects/krptk/discography/kintsugi_single-600x600bb.jpg";
import art47 from "/src/assets/images/projects/krptk/discography/over_single-600x600bb.jpg";
import art48 from "/src/assets/images/projects/krptk/discography/knotionz_vol1_EP-600x600bb.jpg";
import art49 from "/src/assets/images/projects/krptk/discography/luv_me_single-600x600bb.jpg";
import art50 from "/src/assets/images/projects/krptk/discography/how-u-like-that-remix.png";
import art51 from "/src/assets/images/projects/platinum-roses/discography/contemplate-single.jpg";
import art52 from "/src/assets/images/projects/platinum-roses/discography/whatd-i-do-single.jpg";
import art53 from "/src/assets/images/projects/platinum-roses/discography/one-thing-i-know-single.jpg";

export type ReleaseType = "single" | "ep" | "album" | "general";

export interface PlatformLinkSet {
  spotify?: string;
  apple?: string;
  tidal?: string;
  youtube?: string;
  soundcloud?: string;
}

export interface DiscoEntry {
  title: string;
  type: ReleaseType;
  art: string;
  links: PlatformLinkSet;
  note?: string; // optional short blurb shown in the release lightbox
}

export const discography: Record<string, DiscoEntry[]> = {
  "riley": [
    { title: "With the Rain", type: "single", art: art0, links: {"spotify":"https://open.spotify.com/track/2SaapkvKlKTbhrcQpROGAT?si=6728999cee3d4cc7","apple":"https://music.apple.com/us/album/with-the-rain-feat-riley-single/1790476408","youtube":"https://www.youtube.com/watch?v=s5ZICMn1k80"} },
    { title: "Stars (riley remix)", type: "single", art: art1, links: {"spotify":"https://open.spotify.com/track/29NlMvw2a5h7o5sCqgJ7K3?si=f8ae2b4e9aa145b1","apple":"https://music.apple.com/us/album/stars-riley-remix/1660688944?i=1660688945","youtube":"https://www.youtube.com/watch?v=9z8t3nt7ZmA"} },
    { title: "I Was 9 (riley remix)", type: "single", art: art2, links: {"spotify":"https://open.spotify.com/track/3F87Dak8Q41QSNbJfA6AMx?si=14fdcbed18374a3e","apple":"https://music.apple.com/us/album/i-was-9-riley-remix/1649318275?i=1649318276","tidal":"https://tidal.com/browse/album/253512701","youtube":"https://youtu.be/CsQ9kl_a1Y4?si=DOJsUs4qZvEmiplA"} },
    { title: "Better (with John White and riley)", type: "single", art: art3, links: {"spotify":"https://open.spotify.com/track/52lu5hXrnYdWtPb90ImyA6?si=84018c33fb16478d","apple":"https://music.apple.com/us/album/better-single/1556313448","tidal":"https://tidal.com/browse/track/244622029","youtube":"https://youtu.be/YkTWodHhM0o?si=ANBcBe_cGghTjFpJ"} },
    { title: "john white x riley - Losing Hearts", type: "single", art: art4, links: {"spotify":"https://open.spotify.com/track/3lLtkLtBztQd8DiLCAORH5?si=f55f60cc305049c8","apple":"https://music.apple.com/us/album/losing-hearts-feat-john-white/1509147409?i=1509147412","youtube":"https://youtu.be/AloaubmwGEA?si=Mn_ZeImQwfpXb_z8","soundcloud":"https://on.soundcloud.com/qEY7u"} }
  ],
  "adidas-messi": [

  ],
  "sam-denton": [
    { title: "for now,", type: "ep", art: art5, links: {"spotify":"https://open.spotify.com/album/41VQPdMsvw0bLKRAiQ0dsL?si=j5K5fDzhSACNNMooWrQAOQ","apple":"https://music.apple.com/ph/album/for-now/1476295406","tidal":"https://tidal.com/browse/album/245469084"} },
    { title: "dreams", type: "single", art: art6, links: {"spotify":"https://open.spotify.com/track/5X0UGqgAEsG0YWGtkqtvBt?si=0a9f3e0664a54c9a","apple":"https://music.apple.com/us/album/dreams/1573467286?i=1573467301","tidal":"https://tidal.com/browse/track/243956491","youtube":"https://www.youtube.com/watch?v=lA42ghfjvCo"} },
    { title: "better (with riley & john white)", type: "single", art: art7, links: {"spotify":"https://open.spotify.com/track/52lu5hXrnYdWtPb90ImyA6?si=d8d3dedf5e23468b","apple":"https://music.apple.com/us/album/better/1556313448?i=1556313450","tidal":"https://tidal.com/browse/track/244622029","youtube":"https://www.youtube.com/watch?v=YkTWodHhM0o"} },
    { title: "first", type: "single", art: art8, links: {"spotify":"https://open.spotify.com/track/1w4i5qwiRwGOkbMxEBjfyJ?si=f040acca342a4e49","apple":"https://music.apple.com/us/album/first/1493852002?i=1493852052","tidal":"https://tidal.com/browse/track/243488656","youtube":"https://www.youtube.com/watch?v=0QWcpO3q1kA"} },
    { title: "i just might.", type: "single", art: art9, links: {"spotify":"https://open.spotify.com/track/2qazwrjvUxVr8cRSUfDJJt?si=c9166f78e2df4ce6","apple":"https://music.apple.com/us/album/i-just-might/1472805738?i=1472805927","tidal":"https://tidal.com/browse/track/246002376","youtube":"https://www.youtube.com/watch?v=w1bNk5EvylU"} },
    { title: "smoke in the mirror (with samiere)", type: "single", art: art10, links: {"spotify":"https://open.spotify.com/track/6hwmodBKdK50qtvvIPU2kT?si=6803c09fc91d47a5","apple":"https://music.apple.com/us/album/smoke-in-the-mirror-with-samiere/1466027622?i=1466027633","tidal":"https://tidal.com/browse/track/245912176","youtube":"https://www.youtube.com/watch?v=DiubEmfg1oM"} },
    { title: "2:09", type: "single", art: art11, links: {"spotify":"https://open.spotify.com/track/0dhX55OSXJdHfqeNxt4jNg?si=723c5458a64b484d","apple":"https://music.apple.com/us/album/2-09/1451819059?i=1451819133","tidal":"https://tidal.com/browse/track/246154538","youtube":"https://www.youtube.com/watch?v=LWqM12QvhXw","soundcloud":"https://on.soundcloud.com/b5Cqj"} },
    { title: "idkya", type: "single", art: art12, links: {"spotify":"https://open.spotify.com/track/7L8IiYRiALjOpeaAuCIbdq?si=dbac34fcc4e8436c","apple":"https://music.apple.com/us/album/idkya/1442630949?i=1442631257","tidal":"https://tidal.com/browse/track/243348992","youtube":"https://www.youtube.com/watch?v=bUUB3sBHwyA","soundcloud":"https://on.soundcloud.com/1eR4x"} },
    { title: "back to you", type: "single", art: art13, links: {"spotify":"https://open.spotify.com/track/7rTbCF7hmnxpiJwQWGiyK5?si=77e1816ad74d4f30","apple":"https://music.apple.com/us/album/back-to-you-single/1437900119","tidal":"https://tidal.com/browse/track/242202178","youtube":"https://www.youtube.com/watch?v=5Cqq5n7153A","soundcloud":"https://on.soundcloud.com/XoZGT"} }
  ],
  "ryland": [
    { title: "I'm Gonna Be Fine - EP", type: "ep", art: art14, links: {"spotify":"https://open.spotify.com/album/5Wsxv4b0DcdJwxWQhJoslz","apple":"https://music.apple.com/us/album/im-gonna-be-fine-ep/1776148719","tidal":"https://tidal.com/browse/album/395421548","youtube":"https://www.youtube.com/playlist?list=OLAK5uy_lSjvjAEPkMEwrKBp3QPZcf_2BkJ1RPbLI"} },
    { title: "You Should Know - EP", type: "ep", art: art15, links: {"spotify":"https://open.spotify.com/album/3dcyqNJBbex17eICVzfi4S?si=5FXaa4i5Tz6JzCWZX1u6gg","apple":"https://music.apple.com/us/album/you-should-know-ep/1650078036","tidal":"https://tidal.com/browse/album/254309190","youtube":"https://www.youtube.com/playlist?list=OLAK5uy_k68rFLA0eSnvoyseygxYBBdH2nrWp9lu0"} },
    { title: "Portrait", type: "album", art: art16, links: {"spotify":"https://open.spotify.com/album/1YRrSespqvZu2iYa7WSM4X","apple":"https://music.apple.com/us/album/portrait/1556566677","tidal":"https://tidal.com/browse/album/175851104","youtube":"https://www.youtube.com/watch?v=j9_KZDcwg6I&list=OLAK5uy_lP4KNWsjACvqILi5xZWnPrN4s7nxZZrH8&ab_channel=Ryland-Topic"} },
    { title: "Talking - Single", type: "single", art: art17, links: {"spotify":"https://open.spotify.com/album/1tFU6vCOBndpsHS4G0Bk6b","apple":"https://music.apple.com/us/album/talking-single/1550695263","tidal":"https://tidal.com/browse/album/171031166","youtube":"https://www.youtube.com/watch?v=3nYxfzVerys&ab_channel=Ryland-Topic"} },
    { title: "Karma - Single", type: "single", art: art18, links: {"spotify":"https://open.spotify.com/album/7BFWk2MnsBydI9FVNtokgJ","apple":"https://music.apple.com/us/album/karma-single/1540025669","tidal":"https://tidal.com/browse/album/161942070","youtube":"https://www.youtube.com/watch?v=vddP2nWvJ30&ab_channel=Ryland-Topic"} },
    { title: "I've Been Looking For A While Now - Single", type: "single", art: art19, links: {"spotify":"https://open.spotify.com/album/1xEbTebOcFQJpl5sEVJ6p8?si=JZlTs1BNT0iz0oxpI0CDrQ","apple":"https://music.apple.com/us/album/ive-been-looking-for-a-while-now-single/1537916310","tidal":"https://tidal.com/browse/album/160222795","youtube":"https://www.youtube.com/watch?v=0En7Fc5NMmo"} },
    { title: "Lashing Out - EP", type: "ep", art: art20, links: {"spotify":"https://open.spotify.com/album/3cV2NG0rtCRqjeQuB0jrPi","apple":"https://music.apple.com/us/album/lashing-out-ep/1513245392","tidal":"https://tidal.com/browse/album/141435524","youtube":"https://www.youtube.com/watch?v=iFaFUDRdQM8&list=OLAK5uy_lc2utY1UM_LNoogjtn98ubuCFW_xc2Cjo"} },
    { title: "Stairwell - Single", type: "single", art: art21, links: {"spotify":"https://open.spotify.com/album/6dbexdk9Vzpr0kPYqp36QR","apple":"https://music.apple.com/us/album/stairwell-single/1482802988","tidal":"https://tidal.com/browse/album/119716422","youtube":"https://youtu.be/DB4k8_zpkJw"} },
    { title: "Itinerary - EP", type: "ep", art: art22, links: {"spotify":"https://open.spotify.com/album/2I19mObRLLNKzm2HCHJf42?si=VnLqR5ZQQDqwfyyW__gDTA","apple":"https://music.apple.com/us/album/itinerary-ep/1473164315","tidal":"https://tidal.com/browse/album/113394980","youtube":"https://www.youtube.com/watch?v=7YUkplOVhtM&list=OLAK5uy_nrGLK171l7gdvuUYFm5wBp3KdVRm1M33w"} }
  ],
  "aubit-sound": [
    { title: "ODESSA Vol. 3", type: "general", art: art23, links: {"youtube":"https://www.youtube.com/watch?v=_gMnFRN7WDw"} },
    { title: "Garyx Vol. 1", type: "general", art: art24, links: {"youtube":"https://www.youtube.com/watch?v=SMjeEuZqL04","soundcloud":"https://soundcloud.com/synthpresets/aubit-sound-garyx-vol-1-serum-presets-midi-samples"} },
    { title: "Gray Vol. 2", type: "general", art: art25, links: {"soundcloud":"https://soundcloud.com/aubitofficial/gray-vol-2"} },
    { title: "Louv Vol. 1", type: "general", art: art26, links: {"soundcloud":"https://soundcloud.com/aubitofficial/louv-vol-1"} },
    { title: "Plume Vol. 1", type: "general", art: art27, links: {"soundcloud":"https://soundcloud.com/aubitofficial/plume-vol-1"} },
    { title: "Gray Vol. 1", type: "general", art: art28, links: {"soundcloud":"https://soundcloud.com/aubitofficial/gray-vol-1"} },
    { title: "Chain-Pop Vol. 1", type: "general", art: art29, links: {"youtube":"https://www.youtube.com/watch?v=2Nxc97Dsnws","soundcloud":"https://soundcloud.com/aubitofficial/chain-pop-vol-1"} },
    { title: "Snakes for Serum Vol. 1", type: "general", art: art30, links: {"youtube":"https://www.youtube.com/watch?v=rwza_-8Dwik","soundcloud":"https://soundcloud.com/flp-family/25-free-dj-snake-style-presets"} },
    { title: "Broox Bounce Vol. 1", type: "general", art: art31, links: {"youtube":"https://www.youtube.com/watch?v=hit_3cN9z6g","soundcloud":"https://on.soundcloud.com/fm3dn"} },
    { title: "Masa Vocal Chops", type: "general", art: art32, links: {"youtube":"https://www.youtube.com/watch?v=JEnpus1ksqw"} },
    { title: "Petit Vocal Chops", type: "general", art: art33, links: {"youtube":"https://www.youtube.com/watch?v=-QoPWwA8gZs"} },
    { title: "Awake Vol. 1", type: "general", art: art34, links: {"youtube":"https://www.youtube.com/watch?v=yULUwFa1cTg"} },
    { title: "1975 for Serum", type: "general", art: art35, links: {"youtube":"https://www.youtube.com/watch?v=BoVvdXQ39DA"} },
    { title: "Ultrallenium Vocal Chops", type: "general", art: art36, links: {"soundcloud":"https://soundcloud.com/aubitofficial/ultrallenium-vocal-chops"} },
    { title: "Jacc for Massive Vol. 1", type: "general", art: art37, links: {"youtube":"https://www.youtube.com/watch?v=cJp_3U7y6Yo"} },
    { title: "ODESSA Vol. 2", type: "general", art: art38, links: {"soundcloud":"https://soundcloud.com/aubitofficial/odessa-ultimate-soundset-vol-2"} }
  ],
  "john-white": [
    { title: "betchu wish u could take it back", type: "single", art: art39, links: {"spotify":"https://open.spotify.com/album/5xG9WKhRF1ve48GMnDdInB?si=7y49yfvlRNqACC7uECI88g","apple":"https://embed.music.apple.com/us/album/fake-smiles-ep/1678254661","youtube":"https://youtube.com/playlist?list=olak5uy_m2wbnwqklx4ez6u2smtzdiqnx5nsflqbi","soundcloud":"https://soundcloud.com/johnwhitesmusic/fake-smiles-mixmaster-1"} },
    { title: "stars (riley remix)", type: "single", art: art40, links: {"spotify":"https://open.spotify.com/track/29NlMvw2a5h7o5sCqgJ7K3?si=4c5c7aacc383407a","apple":"https://music.apple.com/us/album/stars-riley-remix-single/1660688944","youtube":"https://youtu.be/9z8t3nt7zma"} },
    { title: "whoever you want to be - single", type: "single", art: art41, links: {"spotify":"https://open.spotify.com/track/42W4JMlVCjf41SmqcimLhz?si=e40a72ca719e4625","apple":"https://music.apple.com/us/album/whoever-you-want-to-be-single/1630867196","youtube":"https://youtu.be/toxcnzk9xoo","soundcloud":"https://soundcloud.com/johnwhitesmusic/johnwhite-whoeveryouwanttobe"} },
    { title: "better (with sam denton & riley) - single (2021)", type: "single", art: art42, links: {"spotify":"https://open.spotify.com/track/52lu5hXrnYdWtPb90ImyA6?si=112307d4c45a4830","apple":"https://music.apple.com/us/album/better-single/1556313448","youtube":"https://youtu.be/yktwodhhm0o"} }
  ],
  "brand-x": [
    { title: "Spiraling (from Spiraling EP)", type: "general", art: art43, links: {"spotify":"https://open.spotify.com/track/2GUzeTEMKnWAjMWYA1Ui4V?si=5c39d40150734f62","apple":"https://music.apple.com/us/album/spiraling/1668083016?i=1668083021","youtube":"https://www.youtube.com/watch?v=AfTfGX5Wvrg&list=OLAK5uy_lhtTc3b8h0HPzM8iobZ40xmw4Cn38tGos"} },
    { title: "Tom's Diner (from Mixtape)", type: "general", art: art44, links: {"spotify":"https://open.spotify.com/track/4zBtv57k0H4dFcvSZSWDla?si=3ba3c0c6c8fe445f","apple":"https://music.apple.com/id/album/toms-diner/1705680543?i=1705680547","youtube":"https://www.youtube.com/watch?v=H8iVHmDxlBk"} },
    { title: "Don't Pretend (from Popfest Vol. 2)", type: "general", art: art45, links: {"spotify":"https://open.spotify.com/track/63SLRotYth5eukYcJw0Trt?si=939f1c747cb14117","apple":"https://music.apple.com/us/album/dont-pretend/1692907111?i=1692907112","youtube":"https://www.youtube.com/watch?v=bjuaf-LfdWg"} }
  ],
  "krptk": [
    { title: "Kintsugi - Single", type: "single", art: art46, links: {"spotify":"https://open.spotify.com/track/3uLhL3hk0rRo9w5L00Qn96?si=67a52b363d6744d4","apple":"https://music.apple.com/us/album/kintsugi/1620459267?i=1620459520","tidal":"https://tidal.com/browse/track/225869369","youtube":"https://www.youtube.com/watch?v=1z1o5ZM_DnU"} },
    { title: "Over - Single", type: "single", art: art47, links: {"spotify":"https://open.spotify.com/track/0J6iZXCOKn1cOD1GmlPSsv?si=a2546d14824a4940","apple":"https://music.apple.com/us/album/over/1657955629?i=1657955630","tidal":"https://tidal.com/browse/track/264432077","youtube":"https://www.youtube.com/watch?v=ZXffX5yiey4"} },
    { title: "Knotionz Vol.1 - EP", type: "ep", art: art48, links: {"spotify":"https://open.spotify.com/album/3aYf5U7SebWREMihnVyksc?si=46bvcOuhQYW4TqboM0J6Qw","apple":"https://music.apple.com/us/album/knotionz-vol-1-single/1656560644","tidal":"https://tidal.com/browse/album/262949063","youtube":"https://www.youtube.com/watch?v=r65-6pplMmk"} },
    { title: "Luv Me - Single", type: "single", art: art49, links: {"spotify":"https://open.spotify.com/track/1yJa71ZQLwCk6lXHkQnuUx?si=013086c1398b4cc0","apple":"https://music.apple.com/us/album/luv-me/1656552144?i=1656552147","tidal":"https://tidal.com/browse/track/262939586","youtube":"https://www.youtube.com/watch?v=SL1276GEgl0"} },
    { title: "BLACKPINK - How You Like That (KRPTK REMIX Cover)", type: "single", art: art50, links: {"youtube":"https://www.youtube.com/watch?v=oGntp56pPL8"} }
  ],
  "platinum-roses": [
    { title: "Contemplate - single", type: "single", art: art51, links: {"spotify":"https://open.spotify.com/track/2ELwGfn2Csr7g6xo41ijtG?si=dc09680c17bd4fc6","apple":"https://music.apple.com/us/album/contemplate-single/1445320598","youtube":"https://youtu.be/vxj_UcpPxaw?si=poVRRqn0C2k0dMyn","soundcloud":"https://on.soundcloud.com/7eKxH"} },
    { title: "What'd I Do - single", type: "single", art: art52, links: {"spotify":"https://open.spotify.com/track/5kj8UE9PJWi1eMKRPKAzsL?si=a9a879f0b8054fa5","apple":"https://music.apple.com/us/album/whatd-i-do-single/1362745750","youtube":"https://youtu.be/fzHnkK12r_U?si=6rVEtnHLg0Z_twLF","soundcloud":"https://on.soundcloud.com/kATbu"} },
    { title: "One Thing I Know - single", type: "single", art: art53, links: {"spotify":"https://open.spotify.com/track/7gXk8WVfiAitbPjDSTv0L8?si=9da86dab6c694505","apple":"https://music.apple.com/us/album/one-thing-i-know-single/1320562860","youtube":"https://youtu.be/2rWabGeJPUA?si=SpETE2jfm1LocQMe","soundcloud":"https://on.soundcloud.com/Mjina"} }
  ]
};

export const discographyFor = (id: string): DiscoEntry[] => discography[id] || [];
