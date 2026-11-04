// data/package-manifest.js
// Package labels and automatic metadata only; data/practices.js is the sole canon.
// The fixed aliases below preserve progress/links from releases before single-canon.
// They are historical migration data, never titles, lesson content, or a unit list.
// Adding, editing, deleting, or reordering units needs NO edit in this file.
import { practices } from './practices.js';
import { sourceUnitId, isUnitId, isSourceNumber } from '../js/unit-identity.js';

const packageInfo = Object.freeze({
  "packageId": "filsafat-1",
  "schemaVersion": 2,
  "brand": "Dynanca",
  "workspace": "Filsafat",
  "name": "FILSAFAT - 1",
  "language": "id",
  "description": "Paket latihan argumentasi filsafat: membaca kasus, menyatakan posisi, memeriksa definisi dan premis, menghadapi sanggahan, lalu merevisi dan menyintesis kesimpulan beserta batasnya."
});

const historicalAliases = Object.freeze({
  "1": [
    "p_nzr17j7as6",
    "p_ns4nh7umqg",
    "p_2ahy1487a8m",
    "auto-xe9p6r5sv9",
    "p_1eqpfxs27jg",
    "auto-2blusfpup4h"
  ],
  "2": [
    "p_pyc1n71w78",
    "p_j6yltufc61",
    "auto-gzr4yap4pt",
    "p_mxg42ifs3y",
    "auto-19whkbq4gl9"
  ],
  "3": [
    "p_ywnclsyn0v",
    "p_tx6nn4xgl4",
    "auto-5zydyckfbp",
    "p_1g3ab8vcvoq",
    "auto-jcskawj1br"
  ],
  "4": [
    "p_1zxm3qwxreq",
    "p_25y6g2ultne",
    "auto-28h9zodzj8a",
    "auto-d11p8igjq4",
    "p_12wqor8nn4s",
    "auto-20m69uucowl"
  ],
  "5": [
    "p_t1x9mpbi62",
    "p_12yyu5d5axy",
    "auto-1g6fosk9oc8",
    "p_ubb2bvl4os",
    "auto-1bzjrez50b6"
  ],
  "6": [
    "p_vswdvo4vc9",
    "auto-1t0kn0tccxh",
    "p_281acs3v7pp",
    "auto-2a4bwwfbplv"
  ],
  "7": [
    "p_lzqhmkm95s",
    "auto-1938eom5656",
    "p_1nxpk8uq1pc",
    "auto-1h8l00nt0t9"
  ],
  "8": [
    "p_tfmb02tu4a",
    "auto-wj6e96zz46",
    "p_1o4avtryve3",
    "auto-aw15msyowh"
  ],
  "9": [
    "p_2g32zvmkefq",
    "auto-hc2oo7lxlx",
    "p_u5z39xl8xh",
    "auto-2clxixl3ypo"
  ],
  "10": [
    "p_162cnyuwq4m",
    "auto-14klmzgs7ft",
    "p_2ck7u1ywag7",
    "auto-24kbq2d6o91"
  ],
  "11": [
    "p_1tb2fi7lbxa",
    "auto-1veovizb8t3",
    "p_10vkvdctvie",
    "auto-25684gvagdu"
  ],
  "12": [
    "p_wajnkd5j0t",
    "auto-bw7nfqj5yc"
  ],
  "13": [
    "p_82rg60jm38",
    "auto-24yykjfrf1b"
  ],
  "14": [
    "p_22zheq61c6t",
    "auto-yvqvzsk7dz"
  ],
  "15": [
    "p_13cpvbqespa",
    "auto-v36xpk1bgh"
  ],
  "16": [
    "p_1ufbrh5ac8b",
    "auto-1m84s4hr75v"
  ],
  "17": [
    "p_o7xk32he02",
    "auto-1ltjga35zs5"
  ]
});

/** Fresh metadata follows the source array; no source object is mutated. */
export function derivePackageManifest(source = practices) {
  const units = Array.isArray(source) ? source.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)).map((entry) => {
    const id = sourceUnitId(entry, packageInfo.packageId) || '';
    const legacyIds = [...new Set([
      ...(isSourceNumber(entry.number) ? historicalAliases[entry.number] || [] : []),
      ...(Array.isArray(entry.legacyIds) ? entry.legacyIds.filter(isUnitId) : []),
    ])].filter((alias) => alias !== id);
    return {
      number: isSourceNumber(entry.number) ? entry.number : null,
      id,
      title: typeof entry.title === 'string' ? entry.title : '',
      legacyIds,
      difficulty: entry.difficulty ?? null,
      provenance: entry.source ?? null,
    };
  }) : [];
  return { ...packageInfo, units };
}

export const packageManifest = derivePackageManifest();
