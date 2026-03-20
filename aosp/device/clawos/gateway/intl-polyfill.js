// Minimal Intl polyfill for Node.js binaries compiled without ICU support.
// Loaded via --require before the OpenClaw Gateway entry point.
// Uses function constructors (not ES6 classes) so they work without 'new'.

if (typeof globalThis.Intl !== 'undefined') { /* already available */ }
else {

const pad = (n, w) => String(n).padStart(w || 2, '0')

function DateTimeFormat(locale, opts) {
  if (!(this instanceof DateTimeFormat)) return new DateTimeFormat(locale, opts)
  this._locale = locale || 'en-US'
  this._opts = opts || {}
}
DateTimeFormat.prototype.format = function (d) {
  if (!(d instanceof Date)) d = new Date(d)
  if (isNaN(d.getTime())) return 'Invalid Date'
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}
DateTimeFormat.prototype.formatToParts = function (d) {
  if (!(d instanceof Date)) d = new Date(d)
  return [
    { type: 'year', value: String(d.getFullYear()) },
    { type: 'literal', value: '-' },
    { type: 'month', value: pad(d.getMonth() + 1) },
    { type: 'literal', value: '-' },
    { type: 'day', value: pad(d.getDate()) },
    { type: 'literal', value: ' ' },
    { type: 'hour', value: pad(d.getHours()) },
    { type: 'literal', value: ':' },
    { type: 'minute', value: pad(d.getMinutes()) },
    { type: 'literal', value: ':' },
    { type: 'second', value: pad(d.getSeconds()) },
  ]
}
DateTimeFormat.prototype.formatRange = function (a, b) {
  return this.format(a) + ' – ' + this.format(b)
}
DateTimeFormat.prototype.resolvedOptions = function () {
  return { locale: this._locale, timeZone: 'UTC', calendar: 'gregory', numberingSystem: 'latn' }
}
DateTimeFormat.supportedLocalesOf = function () { return ['en-US'] }

function NumberFormat(locale, opts) {
  if (!(this instanceof NumberFormat)) return new NumberFormat(locale, opts)
  this._locale = locale || 'en-US'
  this._opts = opts || {}
}
NumberFormat.prototype.format = function (n) {
  if (this._opts.style === 'percent') return (n * 100).toFixed(0) + '%'
  if (this._opts.style === 'currency')
    return (this._opts.currency || 'USD') + ' ' + Number(n).toFixed(2)
  if (this._opts.notation === 'compact') {
    var abs = Math.abs(n)
    if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B'
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  }
  var d = this._opts.maximumFractionDigits != null ? this._opts.maximumFractionDigits
        : this._opts.minimumFractionDigits
  return d != null ? Number(n).toFixed(d) : String(n)
}
NumberFormat.prototype.formatToParts = function (n) {
  return [{ type: 'integer', value: this.format(n) }]
}
NumberFormat.prototype.resolvedOptions = function () {
  return { locale: this._locale, numberingSystem: 'latn' }
}
NumberFormat.supportedLocalesOf = function () { return ['en-US'] }

function Collator(locale, opts) {
  if (!(this instanceof Collator)) return new Collator(locale, opts)
  this._opts = opts || {}
}
Collator.prototype.compare = function (a, b) {
  a = String(a); b = String(b)
  if (this._opts.sensitivity === 'base' || this._opts.sensitivity === 'accent') {
    a = a.toLowerCase(); b = b.toLowerCase()
  }
  return a < b ? -1 : a > b ? 1 : 0
}
Collator.prototype.resolvedOptions = function () {
  return { locale: 'en-US', sensitivity: this._opts.sensitivity || 'variant' }
}
Collator.supportedLocalesOf = function () { return ['en-US'] }

function PluralRules(locale, opts) {
  if (!(this instanceof PluralRules)) return new PluralRules(locale, opts)
  this._locale = locale || 'en-US'
  this._opts = opts || {}
}
PluralRules.prototype.select = function (n) {
  n = Math.abs(n)
  if (n === 1) return 'one'
  if (n === 0) return 'zero'
  return 'other'
}
PluralRules.prototype.resolvedOptions = function () {
  return { locale: this._locale, type: this._opts.type || 'cardinal' }
}
PluralRules.supportedLocalesOf = function () { return ['en-US'] }

function ListFormat(locale, opts) {
  if (!(this instanceof ListFormat)) return new ListFormat(locale, opts)
  this._opts = opts || {}
}
ListFormat.prototype.format = function (list) {
  list = Array.from(list)
  if (list.length === 0) return ''
  if (list.length === 1) return String(list[0])
  var conj = this._opts.type === 'disjunction' ? 'or' : 'and'
  return list.slice(0, -1).join(', ') + ' ' + conj + ' ' + list[list.length - 1]
}
ListFormat.prototype.formatToParts = function (list) {
  return [{ type: 'element', value: this.format(list) }]
}
ListFormat.supportedLocalesOf = function () { return ['en-US'] }

function RelativeTimeFormat(locale, opts) {
  if (!(this instanceof RelativeTimeFormat)) return new RelativeTimeFormat(locale, opts)
  this._locale = locale || 'en-US'
  this._opts = opts || {}
}
RelativeTimeFormat.prototype.format = function (value, unit) {
  return value < 0 ? (-value) + ' ' + unit + 's ago' : 'in ' + value + ' ' + unit + 's'
}
RelativeTimeFormat.prototype.formatToParts = function (value, unit) {
  return [{ type: 'literal', value: this.format(value, unit) }]
}
RelativeTimeFormat.prototype.resolvedOptions = function () {
  return { locale: this._locale, style: this._opts.style || 'long' }
}
RelativeTimeFormat.supportedLocalesOf = function () { return ['en-US'] }

function DisplayNames(locale, opts) {
  if (!(this instanceof DisplayNames)) return new DisplayNames(locale, opts)
  this._locale = locale || 'en-US'
  this._opts = opts || {}
}
DisplayNames.prototype.of = function (code) { return code }
DisplayNames.prototype.resolvedOptions = function () {
  return { locale: this._locale, type: this._opts.type || 'language' }
}
DisplayNames.supportedLocalesOf = function () { return ['en-US'] }

function Segmenter(locale, opts) {
  if (!(this instanceof Segmenter)) return new Segmenter(locale, opts)
  this._locale = locale || 'en-US'
  this._opts = opts || {}
}
Segmenter.prototype.segment = function (str) {
  str = String(str)
  var granularity = this._opts.granularity || 'grapheme'
  var segments
  if (granularity === 'word') {
    segments = str.split(/\b/).filter(Boolean).map(function (s, i, arr) {
      return { segment: s, index: arr.slice(0, i).join('').length, isWordLike: /\w/.test(s) }
    })
  } else if (granularity === 'sentence') {
    segments = str.split(/(?<=[.!?]\s)/).map(function (s, i, arr) {
      return { segment: s, index: arr.slice(0, i).join('').length }
    })
  } else {
    segments = Array.from(str).map(function (c, i) { return { segment: c, index: i } })
  }
  segments[Symbol.iterator] = function () {
    var idx = 0, items = segments
    return { next: function () { return idx < items.length ? { value: items[idx++], done: false } : { done: true } } }
  }
  return segments
}
Segmenter.supportedLocalesOf = function () { return ['en-US'] }

globalThis.Intl = {
  DateTimeFormat: DateTimeFormat,
  NumberFormat: NumberFormat,
  Collator: Collator,
  PluralRules: PluralRules,
  ListFormat: ListFormat,
  RelativeTimeFormat: RelativeTimeFormat,
  DisplayNames: DisplayNames,
  Segmenter: Segmenter,
  getCanonicalLocales: function (locales) {
    if (!locales) return []
    return Array.isArray(locales) ? locales.slice() : [String(locales)]
  },
  supportedValuesOf: function () { return [] },
}

} // end if Intl undefined
