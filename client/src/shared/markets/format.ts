import type { MarketCatalogEntry } from './types';

/** DataForSEO country locations use `2000 + ISO 3166-1 numeric code`. */
const ISO_COUNTRY_CODES = `
AW533 AF004 AO024 AI660 AX248 AL008 AD020 AE784 AR032 AM051 AS016 AQ010
TF260 AG028 AU036 AT040 AZ031 BI108 BE056 BJ204 BQ535 BF854 BD050 BG100
BH048 BS044 BA070 BL652 BY112 BZ084 BM060 BO068 BR076 BB052 BN096 BT064
BV074 BW072 CF140 CA124 CC166 CH756 CL152 CN156 CI384 CM120 CD180 CG178
CK184 CO170 KM174 CV132 CR188 CU192 CW531 CX162 KY136 CY196 CZ203 DE276
DJ262 DM212 DK208 DO214 DZ012 EC218 EG818 ER232 EH732 ES724 EE233 ET231
FI246 FJ242 FK238 FR250 FO234 FM583 GA266 GB826 GE268 GG831 GH288 GI292
GN324 GP312 GM270 GW624 GQ226 GR300 GD308 GL304 GT320 GF254 GU316 GY328
HK344 HM334 HN340 HR191 HT332 HU348 ID360 IM833 IN356 IO086 IE372 IR364
IQ368 IS352 IL376 IT380 JM388 JE832 JO400 JP392 KZ398 KE404 KG417 KH116
KI296 KN659 KR410 KW414 LA418 LB422 LR430 LY434 LC662 LI438 LK144 LS426
LT440 LU442 LV428 MO446 MF663 MA504 MC492 MD498 MG450 MV462 MX484 MH584
MK807 ML466 MT470 MM104 ME499 MN496 MP580 MZ508 MR478 MS500 MQ474 MU480
MW454 MY458 YT175 NA516 NC540 NE562 NF574 NG566 NI558 NU570 NL528 NO578
NP524 NR520 NZ554 OM512 PK586 PA591 PN612 PE604 PH608 PW585 PG598 PL616
PR630 KP408 PT620 PY600 PS275 PF258 QA634 RE638 RO642 RU643 RW646 SA682
SD729 SN686 SG702 GS239 SH654 SJ744 SB090 SL694 SV222 SM674 SO706 PM666
RS688 SS728 ST678 SR740 SK703 SI705 SE752 SZ748 SX534 SC690 SY760 TC796
TD148 TG768 TH764 TJ762 TK772 TM795 TL626 TO776 TT780 TN788 TR792 TV798
TW158 TZ834 UG800 UA804 UM581 UY858 US840 UZ860 VA336 VC670 VE862 VG092
VI850 VN704 VU548 WF876 WS882 YE887 ZA710 ZM894 ZW716 XK902
`.trim().split(/\s+/);

const LEGACY_LOCATION_COUNTRIES: Readonly<Record<number, string>> = Object.freeze(
  Object.fromEntries(
    ISO_COUNTRY_CODES.map((entry) => [2_000 + Number(entry.slice(2)), entry.slice(0, 2)]),
  ),
);

export function countryCodeForLocation(
  locationCode: number | null | undefined,
  markets: readonly MarketCatalogEntry[] = [],
): string | null {
  if (locationCode == null) return null;
  return markets.find((market) => market.locationCode === locationCode)?.countryCode
    ?? LEGACY_LOCATION_COUNTRIES[locationCode]
    ?? null;
}

export function locationCodeForCountry(countryCode: string): number | null {
  const normalized = countryCode.trim().toUpperCase();
  const entry = Object.entries(LEGACY_LOCATION_COUNTRIES).find(([, iso]) => iso === normalized);
  return entry ? Number(entry[0]) : null;
}

export function countryName(countryCode: string, locale: string): string | null {
  // ICU builds disagree on blank codes (some throw, some echo ''), so treat
  // them as unknown before asking Intl.
  if (!countryCode.trim()) return null;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(countryCode) ?? null;
  } catch {
    return null;
  }
}

// Primary language subtag plus optional script/region/variant subtags. Older
// ICU builds return a made-up name for malformed codes instead of throwing.
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu;

export function languageName(languageCode: string, locale: string): string | null {
  if (!LANGUAGE_TAG.test(languageCode)) return null;
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(languageCode) ?? null;
  } catch {
    return null;
  }
}

export function formatCountryFromLocation(
  locationCode: number | null | undefined,
  locale: string,
  unknownCountry: string,
  markets: readonly MarketCatalogEntry[] = [],
): string {
  const countryCode = countryCodeForLocation(locationCode, markets);
  return countryCode ? countryName(countryCode, locale) ?? unknownCountry : unknownCountry;
}
