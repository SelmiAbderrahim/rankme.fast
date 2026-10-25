/**
  * Local SEO business selection.
  *
  * One document per site: the business the owner picked from a setup search
  * (`selected`) plus the most recent search results (`candidates`) so a
  * selection is made from what the vendor actually returned, never from a
  * client-supplied identity. Candidates expire; picking a stale or unknown
  * candidate leaves the prior selection intact. Saving a selection never
  * calls the vendor.
  */
import mongoose, { type InferSchemaType } from 'mongoose';

export const BUSINESS_QUERY_MIN_CHARS = 2;
export const BUSINESS_QUERY_MAX_CHARS = 200;
export const BUSINESS_TEXT_MAX_CHARS = 300;
export const BUSINESS_ID_MAX_CHARS = 200;
export const BUSINESS_CANDIDATE_MAX = 10;
/** Search results stay selectable for half an hour. */
export const BUSINESS_CANDIDATE_TTL_MS = 30 * 60 * 1000;

/** Stored optional fields read back as `null`, whether written as null or never written. */
export function orNull<T>(value: T | null | undefined): T | null {
    return value ?? null;
}

const text = (max: number) => ({ type: String, default: null, trim: true, maxlength: max });
const latitude = { type: Number, default: null, min: -90, max: 90 };
const longitude = { type: Number, default: null, min: -180, max: 180 };

const businessFields = {
    placeId: text(BUSINESS_ID_MAX_CHARS),
    cid: text(BUSINESS_ID_MAX_CHARS),
    name: { type: String, required: true, trim: true, maxlength: BUSINESS_TEXT_MAX_CHARS },
    address: text(BUSINESS_TEXT_MAX_CHARS),
    phone: text(BUSINESS_TEXT_MAX_CHARS),
    domain: text(BUSINESS_TEXT_MAX_CHARS),
    category: text(BUSINESS_TEXT_MAX_CHARS),
    latitude,
    longitude,
};

const candidateSchema = new mongoose.Schema(
    { candidateId: { type: String, required: true, maxlength: 64 }, ...businessFields },
    { _id: false, timestamps: false, strict: 'throw' },
);

const selectedSchema = new mongoose.Schema(
    {
        ...businessFields,
        locationCode: { type: Number, required: true },
        languageCode: { type: String, required: true, maxlength: 16 },
        selectedAt: { type: Date, required: true },
    },
    { _id: false, timestamps: false, strict: 'throw' },
);

const localBusinessProfileSchema = new mongoose.Schema(
    {
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, unique: true },
        selected: { type: selectedSchema, default: null },
        candidates: {
            type: [candidateSchema],
            default: [],
            validate: {
                validator: (value: unknown[]) => value.length <= BUSINESS_CANDIDATE_MAX,
                message: `at most ${BUSINESS_CANDIDATE_MAX} candidates`,
            },
        },
        candidatesQuery: text(BUSINESS_QUERY_MAX_CHARS),
        candidatesLocationCode: { type: Number, default: null },
        candidatesLanguageCode: { type: String, default: null, maxlength: 16 },
        candidatesExpireAt: { type: Date, default: null },
    },
    { timestamps: true, strict: 'throw' },
);

export type LocalBusinessProfileDocument = InferSchemaType<typeof localBusinessProfileSchema>;

export const LocalBusinessProfile = mongoose.model('LocalBusinessProfile', localBusinessProfileSchema);
