import { countryName } from './format';

/** Google search observations use alpha-3 codes; Intl labels use alpha-2. */
const ALPHA3_ALPHA2 = `
ABWAW AFGAF AGOAO AIAAI ALAAX ALBAL ANDAD AREAE ARGAR ARMAM ASMAS ATAAQ ATFTF
ATGAG AUSAU AUTAT AZEAZ BDIBI BELBE BENBJ BESBQ BFABF BGDBD BGRBG BHRBH BHSBS
BIHBA BLMBL BLRBY BLZBZ BMUBM BOLBO BRABR BRBBB BRNBN BTNBT BVTBV BWABW CAFCF
CANCA CCKCC CHECH CHLCL CHNCN CIVCI CMRCM CODCD COGCG COKCK COLCO COMKM CPVCV
CRICR CUBCU CUWCW CXRCX CYMKY CYPCY CZECZ DEUDE DJIDJ DMADM DNKDK DOMDO DZADZ
ECUEC EGYEG ERIER ESHEH ESPES ESTEE ETHET FINFI FJIFJ FLKFK FRAFR FROFO FSMFM
GABGA GBRGB GEOGE GGYGG GHAGH GIBGI GINGN GLPGP GMBGM GNBGW GNQGQ GRCGR GRDGD
GRLGL GTMGT GUFGF GUMGU GUYGY HKGHK HMDHM HNDHN HRVHR HTIHT HUNHU IDNID IMNIM
INDIN IOTIO IRLIE IRNIR IRQIQ ISLIS ISRIL ITAIT JAMJM JEYJE JORJO JPNJP KAZKZ
KENKE KGZKG KHMKH KIRKI KNAKN KORKR KWTKW LAOLA LBNLB LBRLR LBYLY LCALC LIELI
LKALK LSOLS LTULT LUXLU LVALV MACMO MAFMF MARMA MCOMC MDAMD MDGMG MDVMV MEXMX
MHLMH MKDMK MLIML MLTMT MMRMM MNEME MNGMN MNPMP MOZMZ MRTMR MSRMS MTQMQ MUSMU
MWIMW MYSMY MYTYT NAMNA NCLNC NERNE NFKNF NGANG NICNI NIUNU NLDNL NORNO NPLNP
NRUNR NZLNZ OMNOM PAKPK PANPA PCNPN PERPE PHLPH PLWPW PNGPG POLPL PRIPR PRKKP
PRTPT PRYPY PSEPS PYFPF QATQA REURE ROURO RUSRU RWARW SAUSA SDNSD SENSN SGPSG
SGSGS SHNSH SJMSJ SLBSB SLESL SLVSV SMRSM SOMSO SPMPM SRBRS SSDSS STPST SURSR
SVKSK SVNSI SWESE SWZSZ SXMSX SYCSC SYRSY TCATC TCDTD TGOTG THATH TJKTJ TKLTK
TKMTM TLSTL TONTO TTOTT TUNTN TURTR TUVTV TWNTW TZATZ UGAUG UKRUA UMIUM URYUY
USAUS UZBUZ VATVA VCTVC VENVE VGBVG VIRVI VNMVN VUTVU WLFWF WSMWS XKKXK YEMYE
ZAFZA ZMBZM ZWEZW
`.trim().split(/\s+/);
const ALPHA2_BY_ALPHA3 = new Map(ALPHA3_ALPHA2.map((entry) => [entry.slice(0, 3), entry.slice(3)]));

export function countryCodeFromAlpha3(code: string): string | null {
  return ALPHA2_BY_ALPHA3.get(code.trim().toUpperCase()) ?? null;
}

export function countryLabelFromAlpha3(code: string, locale: string): string {
  const alpha2 = countryCodeFromAlpha3(code);
  return (alpha2 === null ? null : countryName(alpha2, locale)) ?? code.trim().toUpperCase();
}

let alpha2ByEnglishName: Map<string, string> | null = null;

/** Analytics supplies English names; index them only for matching, not display. */
function englishNameIndex(): Map<string, string> {
  if (alpha2ByEnglishName === null) {
    const english = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });
    alpha2ByEnglishName = new Map([...ALPHA2_BY_ALPHA3.values()].map((alpha2) => [String(english.of(alpha2)).toLowerCase(), alpha2]));
  }
  return alpha2ByEnglishName;
}

export function localizeEnglishCountryName(name: string, locale: string): string {
  const alpha2 = englishNameIndex().get(name.trim().toLowerCase());
  return (alpha2 === undefined ? null : countryName(alpha2, locale)) ?? name;
}
