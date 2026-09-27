import type { NpcLook } from '../entities/Models';
import type { ItemId } from './Items';
import type { NpcId, QuestId } from './Quests';
import type { BiomeId, QuestStage } from './Types';

/**
 * Light branching dialogue.
 *
 * Options mostly colour the exchange rather than fork the story — the brief calls
 * for two or three replies per conversation, not a dialogue engine. Each NPC picks
 * an entry node from the current world state, so conversations stay current without
 * any authored bookkeeping.
 */

export interface DialogueContext {
  questStage(id: QuestId): QuestStage;
  hasItem(id: ItemId, count?: number): boolean;
  itemCount(id: ItemId): number;
  level: number;
  shrinesCured: number;
  shrineCured(biome: BiomeId): boolean;
  flag(name: string): boolean;
  victory: boolean;
}

export type DialogueAction =
  | { kind: 'startQuest'; quest: QuestId }
  | { kind: 'turnIn'; quest: QuestId }
  | { kind: 'shop' }
  | { kind: 'flag'; name: string }
  | { kind: 'rest' }
  | { kind: 'close' };

export interface DialogueOption {
  text: string;
  next?: string;
  action?: DialogueAction;
  when?: (ctx: DialogueContext) => boolean;
}

export interface DialogueNode {
  /** Overrides the NPC's name in the speaker slot, for narration lines. */
  speaker?: string;
  lines: string[];
  options?: DialogueOption[];
}

export interface NpcDef {
  id: NpcId;
  name: string;
  role: string;
  look: NpcLook;
  /** Position in the village square: [right, forward] in world units. */
  place: [number, number];
  /** Facing angle in radians, measured from the village's forward axis. */
  facing: number;
  entry(ctx: DialogueContext): string;
  nodes: Record<string, DialogueNode>;
}

const SHRINE_QUESTS: Array<{ quest: QuestId; biome: BiomeId }> = [
  { quest: 'emberwoodShrine', biome: 'greenwood' },
  { quest: 'dunesShrine', biome: 'dunes' },
  { quest: 'tundraShrine', biome: 'tundra' },
  { quest: 'cinderShrine', biome: 'cinder' },
];

/** The next shrine quest that is ready to be offered or handed in, if any. */
function activeShrineQuest(ctx: DialogueContext): { quest: QuestId; biome: BiomeId } | null {
  for (const entry of SHRINE_QUESTS) {
    const stage = ctx.questStage(entry.quest);
    if (stage !== 'complete') return stage === 'unavailable' ? null : entry;
  }
  return null;
}

export const NPCS: Record<NpcId, NpcDef> = {
  mira: {
    id: 'mira',
    name: 'Elder Mira',
    role: 'Keeper of the Hearth',
    look: 'elder',
    place: [-3.2, -4.4],
    facing: 0.5,
    entry(ctx) {
      if (ctx.victory) return 'victory';
      if (ctx.questStage('firstLight') === 'notStarted') return 'intro';
      if (ctx.questStage('firstLight') === 'inProgress') return 'firstLightNag';
      if (ctx.questStage('firstLight') === 'readyToTurnIn') return 'firstLightDone';
      const active = activeShrineQuest(ctx);
      if (!active) return 'idle';
      const stage = ctx.questStage(active.quest);
      if (stage === 'notStarted') return `offer_${active.quest}`;
      if (stage === 'readyToTurnIn') return `done_${active.quest}`;
      return `nag_${active.quest}`;
    },
    nodes: {
      intro: {
        lines: [
          'You have your mother’s stubborn jaw. Good. You will need it.',
          'Four shrines ring this little world, and every one of them has gone quiet. The blight got in.',
          'It has already reached our own meadow. Start there, where the grass is still worth saving.',
        ],
        options: [
          { text: 'Tell me what to do.', next: 'introTask' },
          { text: 'What is the blight, really?', next: 'lore' },
          { text: 'Why me?', next: 'whyMe' },
        ],
      },
      lore: {
        lines: [
          'A sickness of the ground itself. It does not hate you. That is the worst of it.',
          'Where a shrine sings, the land remembers how to be itself. Where it is silent, the land forgets.',
        ],
        options: [
          { text: 'So I make them sing again.', next: 'introTask' },
          { text: 'And if I fail?', next: 'whyMe' },
        ],
      },
      whyMe: {
        lines: [
          'Because you are here, and you are asking, and nobody else has done either.',
          'That is usually how it goes.',
        ],
        options: [{ text: 'Fair enough.', next: 'introTask' }],
      },
      introTask: {
        lines: [
          'Four motes have drifted into the meadow. Put them down. Watch how they move before you swing.',
          'Roll through their lunges — do not back away from them. Backing away just gives them room.',
        ],
        options: [
          { text: 'I will clear the meadow.', action: { kind: 'startQuest', quest: 'firstLight' } },
          { text: 'Later.', action: { kind: 'close' } },
        ],
      },
      firstLightNag: {
        lines: ['Four motes, in our own meadow. They drift low and lunge high.'],
        options: [{ text: 'On it.', action: { kind: 'close' } }],
      },
      firstLightDone: {
        lines: [
          'The grass is already standing straighter. You felt that, did you not?',
          'Take these. And take the road east, to the Emberwood.',
        ],
        options: [{ text: 'Thank you.', action: { kind: 'turnIn', quest: 'firstLight' } }],
      },
      offer_emberwoodShrine: {
        lines: [
          'The Emberwood holds its leaves through every season now. Nothing falls. Nothing grows.',
          'Something big has made a home of that shrine. A warden, grown out of the blight itself.',
          'Break it, then lay your hand on the shrine stone.',
        ],
        options: [
          { text: 'I will go.', action: { kind: 'startQuest', quest: 'emberwoodShrine' } },
          { text: 'A warden?', next: 'wardenLore' },
        ],
      },
      wardenLore: {
        lines: [
          'The blight builds itself a keeper for every shrine it takes. Slow things. Strong things.',
          'They telegraph everything they do — they have no cleverness, only weight. Watch the wind-up and move.',
        ],
        options: [
          { text: 'I will go.', action: { kind: 'startQuest', quest: 'emberwoodShrine' } },
          { text: 'Give me a moment.', action: { kind: 'close' } },
        ],
      },
      nag_emberwoodShrine: {
        lines: ['East, past the old fence line. The trees will tell you when you are close — they stop moving.'],
        options: [{ text: 'Going.', action: { kind: 'close' } }],
      },
      done_emberwoodShrine: {
        lines: [
          'I heard it from here. A sound like a held breath letting go.',
          'One down. Take this — it was forged from a shrine-stone a long time ago, and it has been waiting.',
        ],
        options: [{ text: 'Three left.', action: { kind: 'turnIn', quest: 'emberwoodShrine' } }],
      },
      offer_dunesShrine: {
        lines: [
          'The Sunscar Dunes next. Sand fused to glass where the shrine broke.',
          'Things out there keep their distance and spit. Close the gap or die tired.',
        ],
        options: [
          { text: 'Understood.', action: { kind: 'startQuest', quest: 'dunesShrine' } },
          { text: 'Not yet.', action: { kind: 'close' } },
        ],
      },
      nag_dunesShrine: {
        lines: ['South and west, where the grass gives up. Watch for the spitters — they hate being crowded.'],
        options: [{ text: 'Going.', action: { kind: 'close' } }],
      },
      done_dunesShrine: {
        lines: ['Two singing, two silent. The sky over the dunes has gone honest again.'],
        options: [{ text: 'Halfway.', action: { kind: 'turnIn', quest: 'dunesShrine' } }],
      },
      offer_tundraShrine: {
        lines: [
          'Frostpeak. Cold enough that standing still is its own kind of wound.',
          'The wardens up there have had longer to grow. Do not trade blows with them. Trade patience.',
        ],
        options: [
          { text: "I'll keep moving.", action: { kind: 'startQuest', quest: 'tundraShrine' } },
          { text: 'Let me prepare first.', action: { kind: 'close' } },
        ],
      },
      nag_tundraShrine: {
        lines: ['Frostpeak is the white shoulder of the world. You cannot miss it. You can only arrive unready.'],
        options: [{ text: 'Going.', action: { kind: 'close' } }],
      },
      done_tundraShrine: {
        lines: [
          'Three. Three, after all this time.',
          'That leaves the Hollow. Where it started. I would tell you not to go, but I would be lying about wanting you to.',
        ],
        options: [{ text: 'One more.', action: { kind: 'turnIn', quest: 'tundraShrine' } }],
      },
      offer_cinderShrine: {
        lines: [
          'Cinder Hollow is on the far side of the world, and it is the reason for all of this.',
          'The first shrine to fall. The blight has had the longest to settle there, and it has made something terrible.',
          'Come back. That is the whole of my advice. Come back.',
        ],
        options: [
          { text: 'I will finish it.', action: { kind: 'startQuest', quest: 'cinderShrine' } },
          { text: 'I need more time.', action: { kind: 'close' } },
        ],
      },
      nag_cinderShrine: {
        lines: ['Straight down, past everything. You will know the Hollow because nothing there casts a shadow.'],
        options: [{ text: 'Going.', action: { kind: 'close' } }],
      },
      done_cinderShrine: {
        lines: [
          'Listen. The bell is ringing and no one is pulling the rope.',
          'You walked all the way round the world and brought it back with you. Sit down. Eat something.',
        ],
        options: [{ text: 'Gladly.', action: { kind: 'turnIn', quest: 'cinderShrine' } }],
      },
      idle: {
        lines: ['Rest while you can. The world is round; everything comes back around.'],
        options: [{ text: 'Goodbye.', action: { kind: 'close' } }],
      },
      victory: {
        lines: [
          'Four shrines singing at once. I did not think I would hear it again.',
          'Go on, walk it. The whole world. It is only a little one — but it is ours, and it is whole.',
        ],
        options: [{ text: 'I think I will.', action: { kind: 'close' } }],
      },
    },
  },

  tam: {
    id: 'tam',
    name: 'Tam',
    role: 'Shopkeeper',
    look: 'shopkeeper',
    place: [4.6, -2.6],
    facing: -0.9,
    entry(ctx) {
      if (ctx.questStage('tamsErrand') === 'readyToTurnIn') return 'errandDone';
      if (ctx.questStage('tamsErrand') === 'notStarted') return 'errandOffer';
      return 'greet';
    },
    nodes: {
      greet: {
        lines: ['Everything on the counter is honest. Everything under it is a long story.'],
        options: [
          { text: 'Show me what you have.', action: { kind: 'shop' } },
          {
            text: 'How is the research going?',
            next: 'errandNag',
            when: (ctx) => ctx.questStage('tamsErrand') === 'inProgress',
          },
          { text: 'Just passing through.', action: { kind: 'close' } },
        ],
      },
      errandOffer: {
        lines: [
          'You are the one walking into the blight on purpose. Good. I need a favour that only a fool would do.',
          'Bring me five samples of the stuff. Straight off the things you kill, while it is still humming.',
        ],
        options: [
          { text: 'Five samples. Fine.', action: { kind: 'startQuest', quest: 'tamsErrand' } },
          { text: 'What do you want them for?', next: 'errandWhy' },
          { text: 'Show me your stock instead.', action: { kind: 'shop' } },
        ],
      },
      errandWhy: {
        lines: [
          'Because everyone keeps calling it a curse, and curses do not leave residue on a blade.',
          'Whatever this is, it is made of something. I would like to know what.',
        ],
        options: [
          { text: "I'll get your samples.", action: { kind: 'startQuest', quest: 'tamsErrand' } },
          { text: 'Maybe later.', action: { kind: 'close' } },
        ],
      },
      errandNag: {
        lines: ['Five samples. Motes and spitters shed them most. Do not carry them next to your food.'],
        options: [
          { text: 'Show me your stock.', action: { kind: 'shop' } },
          { text: 'Right.', action: { kind: 'close' } },
        ],
      },
      errandDone: {
        lines: [
          'Ha! Look at that. It is not magic at all, it is— well. It is something.',
          'Take the coin. And the elixir. And come back when you find something stranger.',
        ],
        options: [{ text: 'Pleasure doing business.', action: { kind: 'turnIn', quest: 'tamsErrand' } }],
      },
    },
  },

  rook: {
    id: 'rook',
    name: 'Rook',
    role: 'Trainer',
    look: 'trainer',
    place: [1.2, 5.4],
    facing: Math.PI,
    entry(ctx) {
      if (ctx.questStage('rooksTrial') === 'readyToTurnIn') return 'trialDone';
      if (ctx.questStage('rooksTrial') === 'inProgress') return 'trialNag';
      if (ctx.questStage('rooksTrial') === 'notStarted') return 'trialOffer';
      return 'greet';
    },
    nodes: {
      greet: {
        lines: ['Three swings, then stop. The third one is heavy and it leaves you open. Respect it.'],
        options: [
          { text: 'Remind me how to fight.', next: 'lesson' },
          { text: 'Understood.', action: { kind: 'close' } },
        ],
      },
      lesson: {
        lines: [
          'Light, light, heavy. The third cut costs you more stamina and more time — do not throw it first.',
          'Roll costs stamina too, and for a heartbeat in the middle of it nothing can touch you. That heartbeat is the whole game.',
          'Your weapon decides your special. Press it when a crowd closes in, not when you are already safe.',
        ],
        options: [{ text: 'Got it.', action: { kind: 'close' } }],
      },
      trialOffer: {
        lines: [
          'You swing like someone who has never been hit. That is a compliment and an insult, pick one.',
          'Six clean dodges. Roll through an attack, not away from it. Come back when you have them.',
        ],
        options: [
          { text: 'Six dodges.', action: { kind: 'startQuest', quest: 'rooksTrial' } },
          { text: 'How do I know one was clean?', next: 'trialHow' },
        ],
      },
      trialHow: {
        lines: ['You will know. The world goes quiet for a moment and the blow goes through you.'],
        options: [{ text: "I'll go find out.", action: { kind: 'startQuest', quest: 'rooksTrial' } }],
      },
      trialNag: {
        lines: ['Through the attack. Not away from it. Away is just running with extra steps.'],
        options: [{ text: 'Working on it.', action: { kind: 'close' } }],
      },
      trialDone: {
        lines: [
          'Six. And not one of them lucky.',
          'Take the band. It will not make you faster — it will make being fast cheaper.',
        ],
        options: [{ text: 'Thank you, Rook.', action: { kind: 'turnIn', quest: 'rooksTrial' } }],
      },
    },
  },

  hollis: {
    id: 'hollis',
    name: 'Hollis',
    role: 'Hearthkeeper',
    look: 'villager',
    place: [-5.6, 1.8],
    facing: -1.5,
    entry(ctx) {
      if (ctx.victory) return 'victory';
      return 'greet';
    },
    nodes: {
      greet: {
        lines: ['Fire is lit. Sit a while and it will do you good — you look like a walked-on road.'],
        options: [
          { text: 'Rest by the fire.', action: { kind: 'rest' } },
          { text: 'How is everyone holding up?', next: 'mood' },
          { text: 'No time.', action: { kind: 'close' } },
        ],
      },
      mood: {
        lines: [
          'Pip has not slept properly since the sky over the Hollow went that colour.',
          'The rest of us pretend not to look at it. That is holding up, more or less.',
        ],
        options: [
          { text: 'Rest by the fire.', action: { kind: 'rest' } },
          { text: "I'll fix it.", action: { kind: 'close' } },
        ],
      },
      victory: {
        lines: ['Pip slept through the night. First time in a year. I thought you should know.'],
        options: [
          { text: 'Rest by the fire.', action: { kind: 'rest' } },
          { text: 'Good.', action: { kind: 'close' } },
        ],
      },
    },
  },

  pip: {
    id: 'pip',
    name: 'Pip',
    role: 'Village child',
    look: 'child',
    place: [5.2, 3.8],
    facing: -2.3,
    entry(ctx) {
      if (ctx.victory) return 'victory';
      if (ctx.shrinesCured >= 2) return 'impressed';
      return 'greet';
    },
    nodes: {
      greet: {
        lines: [
          'Is it true you can walk all the way round and come back to where you started?',
          'I tried once. I got as far as the fence.',
        ],
        options: [
          { text: 'It is true. I will show you when I get back.', next: 'promise' },
          { text: 'The fence is a good start.', next: 'fence' },
        ],
      },
      promise: {
        lines: ['Promise? Say it properly.'],
        options: [{ text: 'I promise.', action: { kind: 'flag', name: 'promisedPip' } }],
      },
      fence: {
        lines: ['That is what Hollis says. Hollis has never been past the fence either.'],
        options: [{ text: 'Then we are both learning.', action: { kind: 'close' } }],
      },
      impressed: {
        lines: [
          'Two shrines! I heard the second one from here. It sounded like a bell inside a bell.',
          'Are you going to do all four?',
        ],
        options: [
          { text: 'All four.', action: { kind: 'close' } },
          { text: 'One at a time.', action: { kind: 'close' } },
        ],
      },
      victory: {
        lines: ['You did it. You did ALL of it.', 'Can we walk round the world now? You promised. Sort of.'],
        options: [{ text: 'Get your boots.', action: { kind: 'close' } }],
      },
    },
  },
};

export const NPC_LIST = Object.values(NPCS);
