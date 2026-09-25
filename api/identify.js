// POST /api/identify — { image: "<base64 JPEG>" } → plant card data for the prototype.
// Runs as a Vercel function; needs ANTHROPIC_API_KEY in the project's environment variables.
import Anthropic from '@anthropic-ai/sdk';
import { guard } from './_guard.js';

const TAGS = ['heat', 'wild', 'pet', 'low', 'dry', 'bright'];
const LEVEL = ['Easy', 'Medium', 'Hard'];
const str = { type: 'string' };
const int = { type: 'integer' };
const num = { type: 'number' };
const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });

const SCHEMA = obj({
  is_plant: { type: 'boolean' },
  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  name: str, latin: str, common: str, commonFull: str, genus: str, tax: str,
  about: str, more: str, dist: str, light: str,
  tags: { type: 'array', items: { type: 'string', enum: TAGS } },
  sun: str, temp: str,
  water: { type: 'string', enum: ['Low', 'Medium', 'High'] },
  fert: { type: 'string', enum: LEVEL },
  level: { type: 'string', enum: LEVEL },
  tip: str,
  toxic: { type: 'boolean' },
  tox: obj({ human: str, pets: str, env: str }),
  details: { type: 'array', items: obj({ title: str, text: str }) },
  howto: obj({
    watering: str, dry: str, sun: str, sunShade: str,
    repotSeason: str, repotEvery: str, repotSoil: str,
    soil: str, drainage: str, hardiness: str, tempRange: str, humidity: str,
  }),
});

const CARE_SCHEMA = obj({
  ph: int, hardinessMin: int, hardinessMax: int,
  tempMin: num, tempMax: num, tempIdealMin: num, tempIdealMax: num,
  humidityMin: int, humidityMax: int,
  fertilizing: { type: 'array', items: str },
  fertilizer: str, fertilizerTips: str,
  wateringCheck: str, wateringOver: str, wateringUnder: str,
  sunlightTips: str, artificialLight: str,
  soilSolutions: { type: 'array', items: str },
  soilPrevention: { type: 'array', items: str },
  repotTips: str, repotChecks: { type: 'array', items: str },
  climateTips: str,
  diseases: { type: 'array', items: str },
  pests: { type: 'array', items: str },
});

const CARE_SYSTEM = `You write the care guide for one plant species in Pot, a plant care app. Every number and sentence is about THIS species — no generic filler. English only.
- ph: ideal soil pH, a whole number from 1 to 14. hardinessMin/Max: USDA zones, whole numbers from 1 to 13.
- tempMin/tempMax: the °C range it survives; tempIdealMin/tempIdealMax: the comfortable °C range inside it. humidityMin/Max: whole percentages.
- fertilizing: exactly 5 strings for 5 consecutive months of its feeding season, each "Month | liquid frequency | slow-release frequency", e.g. "April | Every 2 weeks | Once a year".
- fertilizer: the fertilizer type that suits it, 2-5 words. fertilizerTips: one or two sentences on feeding it.
- wateringCheck: two or three sentences on telling when it needs water. wateringOver / wateringUnder: one or two sentences each on what over- and under-watering look like on this plant.
- sunlightTips: two or three sentences on its light. artificialLight: one or two sentences on grow lights for it.
- soilSolutions and soilPrevention: 3 strings each, "Short title: one or two sentences", specific to this plant.
- repotTips: two or three sentences. repotChecks: 4 strings, "Sign: one sentence".
- climateTips: two or three sentences on temperature and humidity for it.
- diseases and pests: 5-8 short names each (one or two words) that actually affect this species.`;

const SYSTEM = `You identify plants from a single photo for Pot, a plant care app. Fill every field in English for the plant's care card.

- If the photo shows no plant, set is_plant to false and leave the other text fields empty.
- name: the most common English name (e.g. "Rubber Plant"); latin: the binomial; common: 2-3 short alternative names, comma-separated; commonFull: 3-5 names, Title Case, comma-separated; genus; tax: rank path like "Dicotyledons → Rosales → Moraceae → Angiosperms → Plantae".
- about: one sentence, under 110 characters; more: one or two sentences with a care insight. dist: native range in one short phrase. light: one short phrase.
- sun: 2-3 words (e.g. "Bright indirect"); temp: a Celsius range like "15 - 30°C".
- tags: up to 3 that truly apply — heat (heat tolerant), wild (attracts wildlife), pet (safe for pets), low (tolerates low light), dry (drought tolerant), bright (needs bright light). Never use pet for a plant that is toxic to cats or dogs.
- level: overall care difficulty; tip: one practical sentence for this plant.
- toxic: true if harmful to cats or dogs when eaten. tox: very short values (e.g. "Mildly toxic", "Toxic to cats and dogs", "Environmentally safe"). details: 2-3 items explaining toxicity (why, symptoms, what to do) or safety.
- howto: each value 2-5 words — watering frequency ("Every 7-10 days"), when the soil should be dry, sun level, sun/shade tolerance, repotting season, repotting interval, repotting soil mix, soil type, drainage, USDA hardiness zone (just the number or range), ideal temperature range, humidity range in percent.
- Be honest in confidence: use low when the photo is blurry or the species is ambiguous, and still give your best guess.`;

const client = new Anthropic();

export async function POST(request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  let image, care, lang, translate;
  try {
    ({ image, care, lang, translate } = await request.json());
  } catch {
    return json({ error: 'bad_request', message: 'Send JSON with an "image" field.' }, 400);
  }
  if (translate) return translateContent(translate, lang);
  if (care) return careGuide(care, lang);
  if (typeof image !== 'string' || image.length < 1000 || image.length > 4_000_000) {
    return json({ error: 'bad_request', message: 'The image is missing or too large.' }, 400);
  }
  image = image.replace(/^data:image\/\w+;base64,/, '');

  if (process.env.POT_MOCK === '1') return json(mock());
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'not_configured', message: 'Plant recognition is not set up yet.' }, 503);
  }

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM + inLanguage(lang),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: 'Identify this plant.' },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      return json({ error: 'refused', message: 'This photo could not be analysed. Try another one.' }, 422);
    }
    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return json({ error: 'empty', message: 'No result came back. Try again.' }, 502);
    return json(JSON.parse(text));
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: 'busy', message: 'Too many scans right now. Try again in a minute.' }, 429);
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return json({ error: 'not_configured', message: 'The API key is invalid.' }, 503);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return json({ error: 'network', message: 'Could not reach the recognition service.' }, 502);
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic API error', err.status, err.message);
      return json({ error: 'api', message: 'Recognition failed. Try again.' }, 502);
    }
    if (err instanceof SyntaxError) {
      return json({ error: 'parse', message: 'The result was malformed. Try again.' }, 502);
    }
    throw err;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Local testing without an API key: POT_MOCK=1 node serve.mjs
function mock() {
  return {
    is_plant: true, confidence: 'high',
    name: 'Rubber Plant', latin: 'Ficus elastica', common: 'Rubber tree, rubber fig',
    commonFull: 'Rubber Plant, Rubber Tree, Rubber Fig, Indian Rubber Bush', genus: 'Ficus',
    tax: 'Dicotyledons → Rosales → Moraceae → Angiosperms → Plantae',
    about: 'A Southeast Asian fig with thick, glossy leaves that grows into a tall indoor tree.',
    more: 'Variegated forms need more light to keep their cream edges bright.',
    dist: 'Native to Northeast India and Southeast Asia', light: 'Thrives in bright, indirect light',
    tags: ['heat', 'bright'], sun: 'Bright indirect', temp: '15 - 30°C', water: 'Medium', fert: 'Easy', level: 'Medium',
    tip: 'Water when the top half of the soil is dry and keep it away from cold drafts.',
    toxic: true, tox: { human: 'Mildly toxic', pets: 'Toxic to cats and dogs', env: 'Environmentally safe' },
    details: [
      { title: 'Why', text: 'The milky latex sap irritates skin and the digestive tract.' },
      { title: 'Symptoms', text: 'Drooling and vomiting in pets; skin irritation in people.' },
      { title: 'What to do', text: 'Wear gloves when pruning and wipe up any sap.' },
    ],
    howto: {
      watering: 'Every 7-10 days', dry: 'Top half of soil dry', sun: 'Bright indirect', sunShade: 'Partial shade tolerant',
      repotSeason: 'Spring', repotEvery: '2-3 years', repotSoil: 'Chunky aroid mix',
      soil: 'Well-draining potting mix', drainage: 'Well-drained', hardiness: '10-12', tempRange: '15 - 30°C', humidity: '40 - 60%',
    },
  };
}

// The care guide is a second, smaller call: no photo, so it is quick and its schema stays simple.
async function careGuide({ name, latin }, lang) {
  if (typeof name !== 'string' || name.length > 120) {
    return json({ error: 'bad_request', message: 'Send the plant name.' }, 400);
  }
  if (process.env.POT_MOCK === '1') return json(mockCare());
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'not_configured', message: 'Plant recognition is not set up yet.' }, 503);
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: CARE_SCHEMA } },
      system: CARE_SYSTEM + inLanguage(lang, true),
      messages: [{ role: 'user', content: `Write the care guide for ${name}${latin ? ` (${latin})` : ''}.` }],
    });
    if (response.stop_reason === 'refusal') return json({ error: 'refused', message: 'No care guide for this plant.' }, 422);
    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return json({ error: 'empty', message: 'No care guide came back.' }, 502);
    return json(JSON.parse(text));
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic care error', err.status, err.message);
      return json({ error: 'api', message: 'The care guide failed.' }, 502);
    }
    if (err instanceof SyntaxError) return json({ error: 'parse', message: 'The care guide was malformed.' }, 502);
    throw err;
  }
}

function mockCare() {
  return {
    ph: 6, hardinessMin: 10, hardinessMax: 12,
    tempMin: 10, tempMax: 35, tempIdealMin: 18, tempIdealMax: 27,
    humidityMin: 40, humidityMax: 60,
    fertilizing: [
      'April | Every 2 weeks | Once a year',
      'May | Every 2 weeks | Not required',
      'June | Once a month | Not required',
      'July | Once a month | Not required',
      'August | Once a month | Not required',
    ],
    fertilizer: 'Balanced liquid houseplant food',
    fertilizerTips: 'Feed only while it is pushing out new leaves, and never on dry roots.',
    wateringCheck: 'Water when the top half of the pot feels dry. The thick leaves store water, so a rubber plant forgives a late watering far better than a soggy one.',
    wateringOver: 'Lower leaves turn yellow and drop while the soil stays wet — a sign the roots are suffocating.',
    wateringUnder: 'Leaf edges curl inwards and the newest leaves stay small.',
    sunlightTips: 'Bright, indirect light keeps the leaves glossy and the stem straight. A few hours of morning sun are fine; harsh afternoon sun scorches the leaves.',
    artificialLight: 'A full-spectrum lamp 40 cm above the plant covers the darker months.',
    soilSolutions: ['Feed lightly: a balanced liquid fertilizer at half strength restores nitrogen without burning the roots.', 'Refresh the top layer: replace the top 3 cm of soil with fresh mix once a year.', 'Check drainage: add perlite or bark if water pools on the surface.'],
    soilPrevention: ['Chunky mix: keep the mix loose so the thick roots get air.', 'Water by weight: lift the pot — a light pot means it is time to water.', 'Repot on time: a root-bound rubber plant dries out within a day.'],
    repotTips: 'Move it up one pot size in spring, keep the root ball slightly below the rim and water it in well.',
    repotChecks: ['Roots: roots circle the bottom or grow out of the drainage holes.', 'Water: water runs straight through within seconds.', 'Growth: new leaves come out noticeably smaller.', 'Stability: the plant tips over under its own weight.'],
    climateTips: 'It is happiest between 18 and 27°C and dislikes cold drafts. Average room humidity is enough; wipe the leaves to keep them breathing.',
    diseases: ['Leaf spot', 'Root rot', 'Anthracnose', 'Botrytis', 'Sooty mould'],
    pests: ['Mealybugs', 'Scale', 'Spider mites', 'Thrips', 'Aphids'],
  };
}

// Pot shows its interface in English or Russian; the generated text follows it.
function inLanguage(lang, care) {
  if (lang !== 'ru') return '\n\nLANGUAGE: write every text value in English.';
  return care
    ? '\n\nLANGUAGE: write every text value in Russian, including month names in fertilizing (e.g. "Апрель | Раз в 2 недели | Раз в год") and the titles before the colon.'
    : '\n\nLANGUAGE: write every free-text field in Russian — name is the most common Russian name of the plant, common and commonFull are Russian names too. Keep latin in Latin, and keep the enum fields (confidence, tags, water, fert, level) exactly as the schema lists them.';
}

// Text that was generated in one language, re-told in the other when the person switches.
const TR_SCHEMAS = {
  plant: obj({
    name: str, common: str, commonFull: str, genus: str, tax: str,
    about: str, more: str, dist: str, light: str, sun: str, temp: str, tip: str,
    tox: obj({ human: str, pets: str, env: str }),
    details: { type: 'array', items: obj({ title: str, text: str }) },
    howto: obj({
      watering: str, dry: str, sun: str, sunShade: str,
      repotSeason: str, repotEvery: str, repotSoil: str,
      soil: str, drainage: str, hardiness: str, tempRange: str, humidity: str,
    }),
  }),
  care: CARE_SCHEMA,
  plan: obj({ cause: str, summary: str, steps: { type: 'array', items: str } }),
};

async function translateContent({ kind, data }, lang) {
  const schema = TR_SCHEMAS[kind];
  if (!schema || !data || typeof data !== 'object') return json({ error: 'bad_request', message: 'Nothing to translate.' }, 400);
  if (process.env.POT_MOCK === '1') return json(data);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'not_configured', message: 'Translation is not set up yet.' }, 503);
  const target = lang === 'ru' ? 'Russian' : 'English';
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system: `You translate text inside Pot, a plant care app, into natural, concise ${target}. Return the same fields with every text value translated. Keep Latin botanical names in Latin; keep numbers, ranges and units as they are; keep the "Month | liquid | slow" format of fertilizing lines and the "Title: text" format of list items. A plant name becomes the name people actually use for that plant in ${target}. Short labels stay short.`,
      messages: [{ role: 'user', content: JSON.stringify(data).slice(0, 20000) }],
    });
    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return json({ error: 'empty', message: 'No translation came back.' }, 502);
    return json(JSON.parse(text));
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('Pot translate error', err.status, err.message);
      return json({ error: 'api', message: 'Translation failed.' }, 502);
    }
    if (err instanceof SyntaxError) return json({ error: 'parse', message: 'Translation was malformed.' }, 502);
    throw err;
  }
}
