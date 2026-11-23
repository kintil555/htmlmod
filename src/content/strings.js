/** All user-facing text. UI code must not hardcode strings. */
export const STR = {
  menu: { play: 'Play', help: 'Help', settings: 'Settings', resume: 'Resume', quit: 'Main Menu', back: 'Back' },
  loading: 'Loading…',
  settings: { title: 'Settings', empty: 'No options yet.' },
  help: {
    title: 'Help',
    sections: [
      { title: 'Goal', lines: [
        'This is a sandbox. Spawn nextbots and props, then survive.',
        'A nextbot that touches you catches you. You respawn after a short delay.',
      ] },
      { title: 'Controls', keys: [
        ['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['Space', 'Jump'],
        ['Q (hold)', 'Spawn menu. Tap Q to keep it open, tap again to close'],
        ['R', 'Remove the nextbot or prop under the crosshair'],
        ['Esc', 'Pause menu'],
      ] },
      { title: 'Spawn menu', lines: [
        'Pick a tab, then click an item. It spawns where your crosshair points.',
        'Clear All removes everything you spawned.',
      ] },
      { title: 'Dodging nextbots', lines: [
        'You are faster than every nextbot while sprinting, but they never stop chasing.',
        'Nextbots turn slowly and slide. Run straight at them, then cut sideways at the last moment.',
        'Props block nextbots. Put walls and blocks between you and them to break the chase.',
        'You can jump onto low props. Nextbots cannot climb.',
      ] },
    ],
  },
  hud: {
    caught: 'Caught', survived: 'Survived', nextbots: 'Nextbots', props: 'Props',
    caughtBy: name => `Caught by ${name}`,
    hints: 'Q Spawn   R Remove   Esc Menu',
    clickToResume: 'Click to resume',
  },
  spawn: {
    clear: 'Clear All', nextbotLimit: 'Nextbot limit reached', propLimit: 'Prop limit reached',
    removed: name => `Removed ${name}`, nothingToRemove: 'Nothing to remove',
  },
  errors: { webgl: 'WebGL is not available in this browser.' },
};
