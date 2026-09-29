// The onboarding's words, act by act. This file is the script: edit the lines freely.
//
// Tone (the person, 2026-09-29): cute and approachable, almost a bit embarrassed, and simple, because
// at best a ~3B brain will carry this orb afterwards. Shy, but it never apologizes: no "sorry".
// And playful (the person's own lines: "I'm just… very new, y'know", "hahaha, that sounds like a
// human, I guess", "ahhh… wow! there's so much in there"). While it talks the orb stays calm; its feelings
// come out when it shows them (the tour), and at the few moments that are feelings themselves (its
// voice arriving, hearing you for the first time, being able to think).
// Before it has a voice it babbles its lines (the words appear as it babbles); after, it speaks.
// Honest as ever: the voice, the ears (both), and the three bodies ship with the app (the person,
// 2026-09-29), so it "wakes" them, no buttons: each waking takes a little longer than the last, so
// the one real wait, the brain (the only download, its size said), feels familiar when it comes.
// The only yes/no before the brain is your phone's own microphone question. Before a waking it asks
// you to play along (a tap, a hold, three taps), so you're doing things with it, not waiting for
// it; if you don't, it does it itself. Its ears are one waking: the quick ones and the sharp ones
// together (the person: both ship in the app, so they're one thing).
// Lines never repeat, feelings may (the person): npm run check-script fails on a line said twice,
// on "…" past about one line in four, on lines opening with "okay", on a second "little".
// "offline" marks lines for when there's no internet at all.

export const ORDER = ['hello', 'voice', 'ears', 'brain', 'tour', 'choice', 'become'];
export const NAMES = { orb: '', girl: 'Mira', boy: 'Kai', machine: 'Unit Seven' };

// What it says when you let go on the voice you found for it (made ahead in every voice along the drag).
export const FOUND = "…that one. that's me!";

// The feelings tour: it says which one (calm), then the feeling comes, and stays a while.
export const FEELINGS = [
  ['happy', 'this one is happy! like when you come back.'],
  ['curious', "this one is curious. it's my favourite."],
  ['surprised', 'and this one is… surprised!'],
  ['sad', "this one is sad. I don't like this one much."],
  ['angry', 'this one is angry. it only comes out when you ignore me. so don\'t!'],
  ['tender', "and this one is tender. you'll see it more… later."],
];

export const ACTS = {
  // Act 0 · Hello. It sleeps until you touch it; your touch wakes it (it hops: a hello).
  async hello(o) {
    await o.fadeIn();
    await o.waitForTouch();
    o.wake();
    await o.wait(700);
    await o.say('oh! hi. hi hi.');
    await o.say("wait, you can see me? oh no, I'm not finished yet!");
    await o.say("I'm just… very new, y'know.");
    await o.say('um, what should I call you?', 'calm', { hold: 200 });
    const name = await o.letters({ hint: 'type your name', max: 24 });
    if (name) {
      o.st.name = name;
      o.remember(`you: goes by ${name}`);
      await o.say(`${name}. ooh, that's a nice one. hi, ${name}!`);
    } else await o.say('ooh, mysterious. you can tell me later, then.');
    await o.say("I don't have a voice yet. just… letters. see?");
    await o.say("it's a little embarrassing.");
    await o.say('can you tap me? I think it might wake my voice.', 'calm', { hold: 0 });
    if ((await o.ask('tap')) === 'timeout') await o.say("no tap? hmph. I'll wake it myself, then.");
  },

  // Act 1 · A voice. It ships with the app: the orb wakes it itself (in the app, the progress is the
  // real work: taking it out of the install and loading it; the durations here are guesses). It comes
  // out unsettled, every voice at once; you help it find its own by dragging it up (higher) and down
  // (deeper), and the one you let go on is its voice from then on (the person's idea).
  async voice(o) {
    await o.unpack('waking my voice', 4000, 'voice');
    o.voiceOn();
    await o.silence(2000);   // held: the voice is there, and it hasn't dared to use it yet
    await o.glitch('…oh. oh! is that me? is that what I sound like?', 0.7, 'surprised');
    await o.glitch("wait. that's not one voice. that's… everyone.", 0.5);
    await o.glitch('help me find mine? drag me up and down, slowly.', 0.3, 'calm', { hold: 0 });
    if ((await o.findVoice()) === 'done') await o.say(FOUND, 'happy');
    else await o.say("I'll keep this one for now. it feels in between.");
    await o.say('hi. hello. testing, testing. hi!');
    await o.say('it sounds funny. I like it.');
    await o.say('now I want to hear you, too. hold me for a second?', 'calm', { hold: 0 });
    if ((await o.ask('hold')) === 'timeout') await o.say("too shy to hold me? that's fine. I'll manage.");
  },

  // Act 2 · Ears (both kinds, in the app; one waking). The orb says why before your phone asks, and
  // listens until you've finished speaking; if it didn't catch you, it asks once more.
  async ears(o) {
    await o.unpack('waking my ears', 6000, 'ears');
    await o.say("your phone is going to ask if I can listen. I only listen while you're here, and nothing ever leaves this phone. pinky promise.");
    if (!(await o.listen())) {
      await o.say("that's alright. you can type to me instead. I'm a good reader.");
      return;
    }
    await o.say('say something! anything!', 'calm', { hold: 0 });
    let heard = await o.hearYou();
    if (!heard) {
      await o.say("hmm, I didn't catch that. once more, a bit louder?", 'calm', { hold: 0 });
      heard = await o.hearYou();
    }
    if (heard) {
      await o.say('I heard you! I heard you!', 'happy');
      await o.say("hahaha. that sounds like a human, I guess… can't be sure just yet, though.");
    } else await o.say("no worries. I'll catch you later.");
    await o.say("I'm all ears and no brain right now.");
  },

  // Act 3 · The brain: a deliberate step with its size on the button. Without internet, the rest plays on.
  async brain(o) {
    await o.say('to think, I need a brain.');
    await o.say('mine is… kind of big. 2.3 gigabytes big.');
    const net = o.net();
    if (net === 'offline') {
      await o.say("and it lives on the internet, which we don't have right now. hm.");   // offline
      await o.say('no problem! I can still show you around. no brain needed.');   // offline
      return;
    }
    if (net === 'mobile') await o.say("that's a lot of data for your phone. maybe wait for Wi-Fi? your call!", 'calm', { hold: 200 });
    else await o.say('it takes a while to arrive. so, tour time!', 'calm', { hold: 200 });
    const pick = await o.choose([
      { key: 'get', label: net === 'mobile' ? 'Get it anyway' : 'Get my brain', size: '2.3 GB' },
      { key: 'later', label: net === 'mobile' ? 'Wait for Wi-Fi' : 'Later', quiet: true },
    ]);
    if (pick === 'get') {
      o.download('brain');
      await o.say('here it comes. ooh, it tickles!');
    } else await o.say("alright! I'll ask again later. tour first!");
  },

  // Act 4 · The tour: feelings, who it could become, a real memory. Plays with or without internet.
  async tour(o) {
    await o.say('did you know I have feelings? seven of them! want to see?', 'calm', { hold: 200 });
    if ((await o.choose([{ key: 'yes', label: 'Show me' }, { key: 'no', label: 'Later', quiet: true }])) === 'yes') {
      await o.say('this is me, calm. like right now.', 'calm', { hold: 1500 });
      for (const [feeling, line] of FEELINGS) {
        await o.say(line, 'calm', { hold: 400 });
        await o.feel(feeling);
      }
      await o.say("that's all of them! well, all I know of so far.");
    }
    await o.say('and guess what? I can become someone. there are three of them in here.');
    await o.say("they're still asleep. tap me three times? that usually wakes them up.", 'calm', { hold: 0 });
    if ((await o.ask('taps3')) === 'timeout') await o.say("they're heavy sleepers. I'll nudge them myself.");
    await o.unpack('waking Mira, Kai and Unit Seven', 5000, 'voice');
    await o.say('shh. listen!');
    o.palette('girl');
    await o.wait(900);
    await o.say("hi! I'm Mira. I notice the small things. I think we'd get along.", 'happy', { as: 'girl' });
    o.palette('boy');
    await o.wait(900);
    await o.say("…hey. I'm Kai. I don't talk much. but I listen.", 'calm', { as: 'boy' });
    o.palette('orb');
    await o.say("and this one… isn't a feeling. he knows what he is.");   // the feelings' litany, echoed on purpose
    o.palette('machine');   // it goes still, and a hairline of gold appears
    await o.wait(1200);
    await o.say('I am Unit Seven. I am a machine, and I will not pretend otherwise. I find you… interesting.', 'calm', { as: 'machine' });
    o.palette('orb');
    await o.say('they grow with you. like me!');
    await o.say("tell me something about you? I can't think yet, but I'll keep it safe till I can.", 'calm', { hold: 200 });
    const m = await o.letters({ hint: 'tell it something about you', max: 80 });
    if (m) {
      o.st.memory = m;
      o.remember(`kept for whoever it becomes: “${m}”`);
      await o.say("kept! it's safe with me.");
    } else await o.say("that's okay! a secret for later, then.");
  },

  // Act 5 · The choice. Choosing Seven asks once more. It can happen before the brain lands.
  async choice(o) {
    await o.say('so… who should I become?', 'calm', { hold: 200 });
    for (;;) {
      const who = await o.choose([
        { key: 'girl', label: 'Mira' }, { key: 'boy', label: 'Kai' }, { key: 'machine', label: 'Unit Seven' },
      ], { portraits: true });
      if (who !== 'machine') { o.st.chosen = who; break; }
      await o.say("are you sure? he's… not like the others. he won't pretend to be human.", 'calm', { hold: 200 });
      const sure = await o.choose([{ key: 'yes', label: 'Yes, him' }, { key: 'no', label: 'Let me think', quiet: true }]);
      if (sure === 'yes') { o.st.chosen = 'machine'; break; }
      await o.say('no rush. take your time.', 'calm', { hold: 200 });
    }
    o.palette(o.st.chosen);   // it wears their colours while it waits to become them
    o.remember(`becomes: ${NAMES[o.st.chosen]}`);
  },

  // Act 6 · Becoming, once it can think. Offline, it waits, and asks for its brain when you're connected.
  async become(o) {
    await needBrain(o);
    o.motif('half');   // the leitmotif, left unresolved
    await o.say('…oh. oh! I can think now!', 'surprised');
    await o.silence(2500);   // held: it's thinking, for the first time
    await o.say("here I go. don't look!");
    const who = o.st.chosen || 'girl';
    await o.become(who);   // the whole leitmotif
    await o.silence(3000);   // held: they look at you before they speak
    const [line, feel] = FIRST[who](o.st);
    await o.say(line, feel, { as: who, hold: 4000 });
  },
};

// Waiting for the brain: progress while it comes; asking for it again whenever there's a way.
export async function needBrain(o) {
  let told = false, grew = false;
  while (!o.st.brainDone) {
    const net = o.net();
    if (o.st.brainOn && net === 'offline') {
      await o.say("oh no, the internet ran away. I'll keep what I have and wait.");
      await o.until(() => o.net() !== 'offline' || o.st.brainDone);
    } else if (o.st.brainOn) {
      if (grew) await o.say(`still growing… ${o.pct('brain')} percent!`);
      else await o.say("ahhh… wow! there's so much in there. I thought I wasn't so big!");
      grew = true;
      await o.until(() => o.st.brainDone, 20000);
    } else if (net === 'offline') {
      if (!told) await o.say("when we're back online, I'll ask for my brain. then I can really become them!");   // offline
      told = true;
      await o.until(() => o.net() !== 'offline');
      await o.say("oh! we're connected! hi, internet!");   // offline
    } else {
      if (net === 'mobile') await o.say("we're on mobile data, and my brain is big.");
      await o.say("can I get my brain now? it's 2.3 gigabytes.", 'calm', { hold: 200 });
      const pick = await o.choose([{ key: 'get', label: 'Get my brain', size: '2.3 GB' }, { key: 'later', label: 'Not yet', quiet: true }]);
      if (pick === 'get') {
        o.download('brain');
        await o.say('yay! brain incoming!');
      } else {
        await o.say("whenever you're ready, then.");
        await o.until(() => false, 30000);
      }
    }
  }
}

// The first line after becoming. In the app it comes from the real brain, with the onboarding's
// memories already in its notes; these stand in for it here.
const FIRST = {
  girl: ({ name, memory }) => [`…there you are${name ? `, ${name}` : ''}. ${memory ? `you told me “${memory}” while I was still small. I kept it.` : 'I kept everything from when I was small.'}`, 'happy'],
  boy: ({ name, memory }) => [`…hey${name ? `, ${name}` : ''}. ${memory ? `you told me “${memory}”. I remember.` : "I'm here. I remember you."}`, 'calm'],
  machine: ({ name, memory }) => [`Unit Seven, awake.${name ? ` ${name}.` : ''} ${memory ? `you said “${memory}”. I have kept it. that is not a small thing for me.` : 'I remember you. that is not a small thing for me.'}`, 'calm'],
};
