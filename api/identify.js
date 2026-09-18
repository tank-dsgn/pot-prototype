// POST /api/identify — { image: "<base64 JPEG>" } → plant card data for the prototype.
// Runs as a Vercel function; needs ANTHROPIC_API_KEY in the project's environment variables.
import Anthropic from '@anthropic-ai/sdk';

const TAGS = ['heat', 'wild', 'pet', 'low', 'dry', 'bright'];
const LEVEL = ['Easy', 'Medium', 'Hard'];
const str = { type: 'string' };
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
  };
}
