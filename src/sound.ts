/** A quiet original bed: two low sines and a slow noise hiss. No samples. */
export class Ambience {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  on = false

  toggle() {
    if (!this.context) this.start()
    if (!this.context || !this.master) return
    this.on = !this.on
    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(this.on ? 0.07 : 0, now, 0.08)
    if (this.context.state === 'suspended') void this.context.resume()
  }

  private start() {
    const context = new AudioContext()
    const master = context.createGain()
    master.gain.value = 0
    master.connect(context.destination)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 240
    filter.Q.value = 0.4
    filter.connect(master)

    const low = context.createOscillator()
    low.type = 'sine'
    low.frequency.value = 55
    const fifth = context.createOscillator()
    fifth.type = 'sine'
    fifth.frequency.value = 82.4
    const tone = context.createGain()
    tone.gain.value = 0.22
    low.connect(tone)
    fifth.connect(tone)
    tone.connect(filter)
    low.start()
    fifth.start()

    const length = context.sampleRate * 2
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    let brown = 0
    for (let i = 0; i < length; i += 1) {
      brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02
      data[i] = brown * 3.2
    }
    const noise = context.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    const noiseGain = context.createGain()
    noiseGain.gain.value = 0.18
    noise.connect(noiseGain)
    noiseGain.connect(filter)
    noise.start()

    this.context = context
    this.master = master
  }
}
