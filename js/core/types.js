// @ts-check
// Shared JSDoc typedefs from CD-0 (CC-05); typedefs only. Later iterations add the rest.

/** @typedef {string} IsoDate   'YYYY-MM-DD', a local calendar date (no time, no zone) (CC-07) */
/** @typedef {'Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'|'Sun'} WeekdayCode  (CC-07) */
/** @typedef {string} Timestamp 'YYYY-MM-DDTHH:mm:ss.sssZ' from Date#toISOString() (UTC) (CC-07) */
/** @typedef {{ now(): Date }} Clock  infra/clock.js (CC-27) */
/**
 * @typedef {Object} SaveStatus  record service save state (CC-25 rev 1)
 * @property {'idle'|'pending'|'saving'|'saved'|'error'} status
 * @property {IsoDate|null} date        statusOf(date): that date; status(): the most relevant date
 * @property {import('./errors.js').AppError|null} error
 * @property {IsoDate[]} pendingDates   dates waiting, ready or in flight
 */

// ── Persisted shapes (CC-11..CC-14) ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Scores
 * @property {number|null} morning     integer 0–10 or null
 * @property {number|null} afternoon
 * @property {number|null} evening
 */
/**
 * @typedef {Object} FrameworkDerived   stored copy of framework derived values (CC-16)
 * @property {boolean} complete         all three scores present
 * @property {number|null} average      unrounded mean; null if incomplete
 * @property {number|null} low
 * @property {number|null} high
 */
/**
 * @typedef {Object<string, any>} CategoryRecordData  record.category[<id>]: schemaVersion, derived, plus flat
 *          category keys (weekday-extension snapshot, entry fields, parameter snapshot) (CC-11, CC-22)
 */
/**
 * @typedef {Object} DayRecord  (CC-11 rev 1)
 * @property {number} schemaVersion      SCHEMA.record
 * @property {IsoDate} date              key; one record per date
 * @property {Scores} scores
 * @property {string[]} other            ordered "Other" tokens: tag codes and free-text tokens (CC-13)
 * @property {string} comment            '' when none
 * @property {number|null} baseline      effective baseline snapshot (full precision)
 * @property {FrameworkDerived} derived
 * @property {Object<string, CategoryRecordData>} category   exactly one key: the active category id
 * @property {Timestamp} createdAt
 * @property {Timestamp} updatedAt
 */
/**
 * @typedef {Object} WeekdayRow  (CC-12)
 * @property {number} schemaVersion   SCHEMA.weekday
 * @property {WeekdayCode} weekday    key
 * @property {number} baseline        full precision, 0–10
 * @property {Object<string, Object<string, number|string|null>>} category  category[<id>] = { schemaVersion, … }
 */
/** @typedef {'treatment'|'positive'|'event'} TagKind */
/**
 * @typedef {Object} Tag  (CC-13)
 * @property {number} schemaVersion  SCHEMA.tag
 * @property {string} code           key; non-empty, no whitespace, case-sensitive; immutable once created
 * @property {string} label
 * @property {TagKind} kind
 * @property {boolean} retired
 * @property {number} order          display order of chips (ascending)
 */
/**
 * @typedef {Object} Settings  (CC-14)
 * @property {number} schemaVersion        SCHEMA.settings
 * @property {'app'} id                    key
 * @property {string} activeCategory
 * @property {Object<string, Object>} category   category[<id>] = { schemaVersion, <settings keys…> }
 * @property {Timestamp|null} lastExportAt
 * @property {Timestamp|null} lastBackupAt
 * @property {Timestamp|null} lastExportRecordUpdatedAt
 * @property {Timestamp} createdAt
 */

// ── Derive and history (CC-18, CC-19) ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Derived  (CC-18)
 * @property {boolean} complete
 * @property {number|null} average
 * @property {number|null} low
 * @property {number|null} high
 * @property {Object<string, Object<string, number|string|boolean|null>>} category  category[<id>] = metrics
 */
/** @typedef {Object<string, Object<string, number|string|boolean|null>>} HistoryValues  keyed by category id (CC-19) */
/**
 * @typedef {Object} ColumnContext  the one row context of columns, metrics, badges and series (CC-19)
 * @property {DayRecord} record
 * @property {Derived} derived
 * @property {HistoryValues} history
 */
/** @typedef {{ value: number|null, count: number, spanDays: number, partial: boolean }} WindowValue  (CC-19 rev 1) */

// ── Validation (CC-17, CC-23) ───────────────────────────────────────────────────────────────────────

/** @typedef {string} FieldId  record path, e.g. 'scores.morning', 'category.<id>.<key>' (CC-17, CC-23) */
/**
 * @typedef {Object} ValidationIssue  (CC-23)
 * @property {FieldId} field
 * @property {string} code     REQUIRED | NOT_NUMBER | NOT_INTEGER | OUT_OF_RANGE | TOO_MANY_DP | TOO_LONG | … | category codes
 * @property {string} message  user-facing English sentence
 */
/** @typedef {{ ok: boolean, issues: ValidationIssue[] }} ValidationResult  (CC-23) */
/** @typedef {'tap'|'text'} InputKind  save kind of an input (CC-17 rev 1) */
/**
 * @typedef {Object} FieldSpec  the per-field validation spec (CC-17, CC-23 rev 1, CD-5 §3.1)
 * @property {FieldId} id
 * @property {'score'|'decimal'|'int'|'text'|'combo'|'tokens'} type
 * @property {string} label           used in messages
 * @property {boolean} nullable       = !descriptor.required
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [maxDp]
 * @property {number} [maxLength]
 * @property {string[]} [fixedOptions]
 * @property {boolean} [weekdayDefault]
 */

// ── Draft and entry context (CC-17, CC-40) ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} Draft  (CC-17)
 * @property {DayRecord} record    always a valid DayRecord shape; holds only valid values
 * @property {boolean} persisted   true once a version of this date exists in the store
 * @property {Object<FieldId, string>} invalid   raw text of fields whose last edit failed validation
 */
/**
 * @typedef {Object} EntryContext  everything the entry view-model needs besides the draft (CC-40, CD-5 §6.1)
 * @property {WeekdayRow} weekdayRow
 * @property {Derived} derived                   derive(draft.record)
 * @property {HistoryValues} history             this date, over the effective list (cache + pending + draft)
 * @property {Object<FieldId, boolean>} overridden
 * @property {Object<string, string[]>} fieldOptions   combo options by key, most recent first (no fixedOptions)
 * @property {ValidationResult} validation       validateDraft(draft)
 * @property {boolean} persisted
 * @property {SaveStatus} save                   statusOf(date)
 */

// ── Migrations (CC-26) ──────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} MigrationStep  (CC-26)
 * @property {'record'|'weekday'|'tag'|'settings'} kind
 * @property {number} from
 * @property {number} to
 * @property {(obj: Object) => Object} migrate
 */

// ── Category contract and descriptors (CC-20, CC-21) ────────────────────────────────────────────────

/** @typedef {'warning'|'off'|'muted'|'accent'} Tone  presentation hint, always paired with text (CC-21 rev 1) */
/** @typedef {{ id: string, text: string, tone: 'info'|'warning' }} CategoryBadge  (CC-20 rev 1) */
/** @typedef {{ weekday: WeekdayCode, baseline: number, values: Object<string, number|string|null> }} SeedWeekday */
/** @typedef {{ code: string, label: string, kind: TagKind }} SeedTag */
/**
 * @typedef {Object} FieldDescriptor  (CC-21 rev 1)
 * @property {string} key
 * @property {string} label
 * @property {'decimal'|'int'|'text'|'combo'} type
 * @property {string} [unit]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [maxDp]
 * @property {boolean} [weekdayDefault]
 * @property {string[]} [fixedOptions]
 * @property {string} [help]
 * @property {boolean} [required]
 * @property {number} [maxLength]
 * @property {string} [placeholder]
 * @property {'decimal'|'numeric'|'text'} [inputMode]
 * @property {string} [shortLabel]   short table heading (CC-21 rev 1.2, FR-BAS-10)
 */
/**
 * @typedef {Object} MetricDescriptor  entry-screen results (CC-21 rev 1)
 * @property {string} id
 * @property {string} label
 * @property {(ctx: ColumnContext) => number|string|null} get
 * @property {string} format
 * @property {(ctx: ColumnContext) => string|null} [note]
 * @property {boolean} [prominent]
 * @property {'results'|'context'} [group]
 * @property {(ctx: ColumnContext) => Tone|null} [tone]
 * @property {string} [blankText]
 * @property {boolean} [hideWhenBlank]
 */
/**
 * @typedef {Object} ColumnDescriptor  history columns (CC-21 rev 1)
 * @property {string} id
 * @property {string} label
 * @property {(ctx: ColumnContext) => number|string|null} get
 * @property {string} format
 * @property {boolean} [pinned]
 * @property {boolean} [defaultHidden]  hidden until "Show all columns" (FR-HIS-09/10, CC-21 rev 1.4)
 * @property {string} [shortLabel]      History heading when the label is too wide for 375 pt (CC-21 rev 1.5)
 * @property {(ctx: ColumnContext) => Tone|null} [tone]
 * @property {string} [blankText]
 * @property {(ctx: ColumnContext) => string|null} [note]
 */
/**
 * @typedef {Object} CsvColumn  (CC-21)
 * @property {string} header
 * @property {(ctx: ColumnContext) => number|string|null} get
 * @property {string} format  CSV token (CC-09)
 */
/**
 * @typedef {Object} Category  (CC-20 rev 1). M2 properties (chart, groupKey, mainMetric, importRules) are
 *          optional as a group; their typedefs arrive with M2.
 * @property {string} id
 * @property {string} name
 * @property {number} schemaVersion
 * @property {MigrationStep[]} migrations
 * @property {FieldDescriptor[]} settingsFields
 * @property {() => Object} defaultSettings
 * @property {(categorySettings: Object|null|undefined) => Object} paramsFromSettings
 * @property {FieldDescriptor[]} weekdayFields
 * @property {() => SeedWeekday[]} seedWeekdays
 * @property {() => SeedTag[]} defaultTags
 * @property {FieldDescriptor[]} entryFields
 * @property {(record: DayRecord) => ValidationIssue[]} validate
 * @property {(records: DayRecord[]) => Object<string, string[]>} fieldOptions
 * @property {(record: DayRecord, base: FrameworkDerived) => Object} deriveRecord
 * @property {string[]} derivedKeys
 * @property {MetricDescriptor[]} displayMetrics
 * @property {ColumnDescriptor[]} historyColumns
 * @property {{ fileId: string, standard: CsvColumn[], extended: CsvColumn[] }} csv
 * @property {(records: DayRecord[], deriveds: Derived[]) => Object[]} historyMetrics
 * @property {string[]} historyKeys
 * @property {(ctx: ColumnContext) => CategoryBadge[]} dayBadges
 * @property {*} [chart]
 * @property {(ctx: ColumnContext) => string} [groupKey]
 * @property {string} [mainMetric]
 * @property {*} [importRules]
 * @property {*} [statsSplit]
 * @property {*} [mainMetricDisplay]
 * @property {string} [statsLabel]
 */

/**
 * @typedef {Object} QuarantineEntry  (CC-15 rev 1)
 * @property {number} [id]            auto-increment key (absent before insert)
 * @property {number} schemaVersion   SCHEMA.quarantine
 * @property {'records'|'weekdays'|'tags'|'settings'} store
 * @property {string|null} key        original key, if readable
 * @property {string} reason          an ERR code, e.g. 'RECORD_SHAPE', 'MIGRATION_FAILED'
 * @property {string} detail          developer message
 * @property {*} raw                  the original stored value, unmodified
 * @property {Timestamp} quarantinedAt
 * @property {string} appVersion      VERSION at the time (CC-34)
 */

// ── Adapters (CC-27) ────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} StoragePersist  infra/storage-persist.js (CC-27)
 * @property {() => Promise<boolean|null>} persisted   null = API unsupported
 * @property {() => Promise<boolean|null>} persist
 */
/**
 * @typedef {Object} Prefs  infra/prefs.js: rebuildable UI preferences, JSON in localStorage (CC-36)
 * @property {(key: string, fallback: any) => any} get   never throws; fallback when missing or unreadable
 * @property {(key: string, value: any) => void} set     never throws
 */
/** @typedef {Object} IdbFactoryLike   the global indexedDB, or new IDBFactory() from fake-indexeddb (CC-27) */

// ── Persistence gateway (CC-39) ─────────────────────────────────────────────────────────────────────

/** @typedef {'records'|'weekdays'|'tags'|'settings'|'quarantine'} StoreName */
/**
 * @typedef {{ type: 'put', store: StoreName, value: object }
 *         | { type: 'putIfAbsent', store: StoreName, value: object }
 *         | { type: 'add', store: 'quarantine', value: object }
 *         | { type: 'delete', store: StoreName, key: string|number }
 *         | { type: 'clear', store: StoreName }} WriteOp
 */
/**
 * @typedef {Object} WriteResult
 * @property {number} written            puts + adds that were applied
 * @property {Array<string|number>} skipped   keys skipped by putIfAbsent, in op order
 * @property {number} deleted            delete ops applied (whether or not the key existed)
 */
/**
 * @typedef {Object} StoreSnapshot       contents of the stores, each ascending by key
 * @property {DayRecord[]} records
 * @property {WeekdayRow[]} weekdays
 * @property {Tag[]} tags
 * @property {Settings[]} settings       0 or 1 element
 * @property {QuarantineEntry[]} quarantine
 */
/**
 * @typedef {Object} BootReport          (CC-29)
 * @property {number} migrated           objects rewritten by a migration step this boot
 * @property {number} quarantined        objects moved to quarantine this boot
 * @property {number} derivedFixed       unmigrated records whose stored derived copies were wrong
 * @property {number} quarantineTotal    entries in the quarantine store after this boot
 */
/**
 * @typedef {Object} Gateway  (CC-39). readSnapshot, replaceAll and the putIfAbsent op are M2 (CD-1 §14).
 * @property {(store: StoreName) => Promise<object[]>} getAll
 * @property {(store: StoreName, key: string|number) => Promise<object|null>} get
 * @property {(store: StoreName) => Promise<number>} count
 * @property {(ops: WriteOp[]) => Promise<WriteResult>} write          one atomic readwrite transaction
 * @property {(opts: {category: Category, clock: Clock, appVersion: string}) => Promise<BootReport>} boot
 * @property {() => void} close
 */

// ── Services (CC-41) ────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SettingsService  (CC-41). Writes resolve with a ValidationResult (nothing written when !ok) and
 *           reject only with AppError. IT-10 adds markExported.
 * @property {() => Promise<void>} load            reads three stores, seeds/repairs, fills caches (CC-29 step 4)
 * @property {() => Promise<void>} reload          re-read after restore (CC-30)
 * @property {() => Settings} getSettings
 * @property {() => Object} getCategorySettings
 * @property {() => WeekdayRow[]} getWeekdays
 * @property {(code: WeekdayCode) => WeekdayRow} getWeekday
 * @property {() => Tag[]} getTags
 * @property {(code: string) => Tag|null} getTag
 * @property {(code: WeekdayCode, patch: { baseline?: number|string, values?: Object<string, number|string|null> })
 *             => Promise<ValidationResult>} updateWeekday
 * @property {(patch: Object<string, number|string|null>) => Promise<ValidationResult>} updateCategorySettings
 * @property {(tag: SeedTag) => Promise<ValidationResult>} addTag
 * @property {(defs: SeedTag[]) => Promise<ValidationResult & { added: string[] }>} addTags
 * @property {(code: string, patch: { label?: string, kind?: TagKind, retired?: boolean }) => Promise<ValidationResult>} updateTag
 * @property {(codes: string[]) => Promise<void>} reorderTags
 * @property {() => Promise<void>} restoreDefaults
 */

export {};
