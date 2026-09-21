// POST /api/identify — { image: "<base64 JPEG>" } → plant card data for the prototype.
// Runs as a Vercel function; needs ANTHROPIC_API_KEY in the project's environment variables.
import Anthropic from '@anthropic-ai/sdk';

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
  care: obj({
    ph: int,
    hardinessMin: int, hardinessMax: int,
    tempMin: num, tempMax: num,
    tempIdealMin: num, tempIdealMax: num,
    humidityMin: int, humidityMax: int,
    fertilizing: { type: 'array', items: obj({ month: str, liquid: str, slow: str }) },
    fertilizer: str,
    fertilizerTips: str,
    wateringCheck: str,
    wateringOver: str,
    wateringUnder: str,
    sunlightTips: str,
    artificialLight: str,
    soilSolutions: { type: 'array', items: obj({ title: str, text: str }) },
    soilPrevention: { type: 'array', items: obj({ title: str, text: str }) },
    repotTips: str,
    repotChecks: { type: 'array', items: obj({ title: str, text: str }) },
    climateTips: str,
    diseases: { type: 'array', items: str },
    pests: { type: 'array', items: str },
  }),
  howto: obj({
    watering: str, dry: str, sun: str, sunShade: str,
    repotSeason: str, repotEvery: str, repotSoil: str,
    soil: str, drainage: str, hardiness: str, tempRange: str, humidity: str,
  }),
});

const SYSTEM = `You identify plants from a single photo for Pot, a plant care app. Fill every field in English for the plant's care card.

- If the photo shows no plant, set is_plant to false and leave the other text fields empty.
- name: the most common English name (e.g. "Rubber Plant"); latin: the binomial; common: 2-3 short alternative names, comma-separated; commonFull: 3-5 names, Title Case, comma-separated; genus; tax: rank path like "Dicotyledons → Rosales → Moraceae → Angiosperms → Plantae".
- about: one sentence, under 110 characters; more: one or two sentences with a care insight. dist: native range in one short phrase. light: one short phrase.
- sun: 2-3 words (e.g. "Bright indirect"); temp: a Celsius range like "15 - 30°C".
- tags: up to 3 that truly apply — heat (heat tolerant), wild (attracts wildlife), pet (safe for pets), low (tolerates low light), dry (drought tolerant), bright (needs bright light). Never use pet for a plant that is toxic to cats or dogs.
- level: overall care difficulty; tip: one practical sentence for this plant.
- toxic: true if harmful to cats or dogs when eaten. tox: very short values (e.g. "Mildly toxic", "Toxic to cats and dogs", "Environmentally safe"). details: 2-3 items explaining toxicity (why, symptoms, what to do) or safety.
- howto: each value 2-5 words — watering frequency ("Every 7-10 days"), when the soil should be dry, sun level, sun/shade tolerance, repotting season, repotting interval, repotting soil mix, soil type, drainage, USDA hardiness zone (just the number or range), ideal temperature range, humidity range in percent.
- care: the numbers and copy behind the care guide, all for THIS species — no generic filler.
  - ph: the ideal soil pH as a whole number from 1 to 14. hardinessMin/Max: USDA zones, whole numbers from 1 to 13. tempMin/tempMax: the range it survives; tempIdealMin/tempIdealMax: the comfortable range, all °C and inside tempMin…tempMax. humidityMin/Max: whole percentages from 0 to 100.
  - fertilizing: exactly 5 consecutive months covering its feeding season, each with the liquid and slow-release frequency ("Once a month", "Every 2 weeks", "Not required").
  - fertilizer: the fertilizer type that suits it, 2-5 words. fertilizerTips: one or two sentences on feeding it.
  - wateringCheck: two or three sentences on how to tell it needs water. wateringOver / wateringUnder: one or two sentences each on what over- and under-watering look like on this plant.
  - sunlightTips: two or three sentences on its light. artificialLight: one or two sentences on grow lights for it.
  - soilSolutions and soilPrevention: 3 items each, title 2-4 words, text one or two sentences, specific to this plant's soil and feeding.
  - repotTips: two or three sentences. repotChecks: 4 signs it needs repotting, title one word, text one sentence.
  - climateTips: two or three sentences on temperature and humidity for it.
  - diseases and pests: 5-8 short names each (one or two words) that actually affect this species.
- Be honest in confidence: use low when the photo is blurry or the species is ambiguous, and still give your best guess.`;

const client = new Anthropic();

export async function POST(request) {
  let image;
  try {
    ({ image } = await request.json());
  } catch {
    return json({ error: 'bad_request', message: 'Send JSON with an "image" field.' }, 400);
  }
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
      system: SYSTEM,
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
    care: {
      ph: 6, hardinessMin: 10, hardinessMax: 12,
      tempMin: 10, tempMax: 35, tempIdealMin: 18, tempIdealMax: 27,
      humidityMin: 40, humidityMax: 60,
      fertilizing: [
        { month: 'April', liquid: 'Every 2 weeks', slow: 'Once a year' },
        { month: 'May', liquid: 'Every 2 weeks', slow: 'Not required' },
        { month: 'June', liquid: 'Once a month', slow: 'Not required' },
        { month: 'July', liquid: 'Once a month', slow: 'Not required' },
        { month: 'August', liquid: 'Once a month', slow: 'Not required' },
      ],
      fertilizer: 'Balanced liquid houseplant food',
      fertilizerTips: 'Feed only while it is pushing out new leaves, and never on dry roots.',
      wateringCheck: 'Water when the top half of the pot feels dry. The thick leaves store water, so a rubber plant forgives a late watering far better than a soggy one.',
      wateringOver: 'Lower leaves turn yellow and drop while the soil stays wet — a sign the roots are suffocating.',
      wateringUnder: 'Leaf edges curl inwards and the newest leaves stay small.',
      sunlightTips: 'Bright, indirect light keeps the leaves glossy and the stem straight. A few hours of morning sun are fine; harsh afternoon sun scorches the leaves.',
      artificialLight: 'A full-spectrum lamp 40 cm above the plant covers the darker months.',
      soilSolutions: [
        { title: 'Feed lightly', text: 'A balanced liquid fertilizer at half strength restores nitrogen without burning the roots.' },
        { title: 'Refresh the top layer', text: 'Replace the top 3 cm of soil with fresh mix once a year.' },
        { title: 'Check drainage', text: 'Add perlite or bark if water pools on the surface.' },
      ],
      soilPrevention: [
        { title: 'Chunky mix', text: 'Keep the mix loose so the thick roots get air.' },
        { title: 'Water by weight', text: 'Lift the pot — a light pot means it is time to water.' },
        { title: 'Repot on time', text: 'A root-bound rubber plant dries out within a day.' },
      ],
      repotTips: 'Move it up one pot size in spring, keep the root ball slightly below the rim and water it in well.',
      repotChecks: [
        { title: 'Roots', text: 'Roots circle the bottom or grow out of the drainage holes.' },
        { title: 'Water', text: 'Water runs straight through within seconds.' },
        { title: 'Growth', text: 'New leaves come out noticeably smaller.' },
        { title: 'Stability', text: 'The plant tips over under its own weight.' },
      ],
      climateTips: 'It is happiest between 18 and 27°C and dislikes cold drafts. Average room humidity is enough; wipe the leaves to keep them breathing.',
      diseases: ['Leaf spot', 'Root rot', 'Anthracnose', 'Botrytis', 'Sooty mould'],
      pests: ['Mealybugs', 'Scale', 'Spider mites', 'Thrips', 'Aphids'],
    },
  };
}
