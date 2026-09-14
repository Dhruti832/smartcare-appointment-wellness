import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  apiError,
  appointmentAPI,
  communicationAPI,
  feedbackAPI,
  servicesAPI
} from '../services/api'
import { getRole, getUser } from '../services/session'
import DashLayout from '../components/DashLayout'

const LOOKER_URL = process.env.REACT_APP_LOOKER_REPORT_URL

// communicationLogs grows without bound and every concern renders its whole
// reply thread, so show one page at a time rather than all of them at once.
const CONCERNS_PER_PAGE = 5

const NAV = [
  { icon: '▦', label: 'Overview', href: '#top', active: true },
  { icon: '📅', label: 'Appointments', href: '#pending' },
  { icon: '💬', label: 'Messages', href: '#concerns' },
  { icon: '🩺', label: 'Services', href: '#services' },
  { icon: '⭐', label: 'Feedback', href: '#feedback' },
  { icon: '📈', label: 'Analytics', href: '#analytics' }
]

// sentimentLabel is written asynchronously by the analytics pipeline
// (backend/feedback/analyze_sentiment.py), so rows submitted moments ago
// legitimately have none yet -- show that rather than an empty cell.
const SENTIMENT_STATUS = {
  POSITIVE: 'approved',
  NEGATIVE: 'rejected',
  NEUTRAL: 'pending',
  MIXED: 'pending'
}

function initialsOf (name) {
  return (name || '?')
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('')
}

// Audit-trail entries and concern timestamps are raw ISO strings from the
// API, so render them as something a coordinator can read at a glance.
function formatDateTime (iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
}

// Concerns raised through the chatbot carry the full Dialogflow session path
// as patientId when no real patient is identified, so show something readable
// instead of breaking the layout with `projects/.../agent/sessions/…`.
function displayPatientId (id) {
  if (!id) return 'Unknown'
  if (id.includes('@')) return id
  const sessionMatch = id.match(/sessions\/([^/]+)$/)
  if (sessionMatch) return `Guest (chat ${sessionMatch[1].slice(-8)})`
  return id.length > 30 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id
}

// coordinatorId is a raw Firestore auto-ID (20 random chars), and a real
// coordinator username would be an email, so only mask the auto-IDs.
function displayCoordinatorId (id) {
  return /^[A-Za-z0-9]{20}$/.test(id) ? 'a coordinator' : id
}

// messages[0] is the original concern (handleMessage seeds it), so the reply
// count is everything after it. Older documents predate `messages` entirely.
function replyCountOf (concern) {
  return Math.max((concern.messages || []).length - 1, 0)
}

export default function CoordinatorDashboard () {
  const navigate = useNavigate()
  const user = getUser()
  const [pending, setPending] = useState([])
  const [services, setServices] = useState([])
  const [logs, setLogs] = useState(null) // { appointmentId, entries }
  const [concerns, setConcerns] = useState([])
  const [feedback, setFeedback] = useState([])
  const [concernPage, setConcernPage] = useState(0)
  const [chatConcernId, setChatConcernId] = useState(null) // open chat popup
  const [sendingReply, setSendingReply] = useState(false)
  const [notice, setNotice] = useState(null)
  const [replyDrafts, setReplyDrafts] = useState({})
  const [editingId, setEditingId] = useState(null) // serviceId being edited
  const [form, setForm] = useState({})
  const [showNewService, setShowNewService] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newService, setNewService] = useState({
    name: '',
    type: 'consultation',
    description: '',
    durationMinutes: '',
    price: '',
    doctorName: '',
    promoLabel: '',
    discountedPrice: ''
  })

  const say = (kind, text) => setNotice({ kind, text })

  const startEdit = s => {
    setEditingId(s.serviceId)
    setForm({
      doctorName: s.doctorName || '',
      price: s.price ?? '',
      promoLabel: s.promoLabel || '',
      discountedPrice: s.discountedPrice ?? ''
    })
  }

  const setField = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  const saveService = async serviceId => {
    // doctorName / promoLabel are always sent (empty string clears them);
    // price / discountedPrice must be positive, so send them only when filled.
    const payload = {
      doctorName: form.doctorName.trim(),
      promoLabel: form.promoLabel.trim()
    }
    if (String(form.price).trim() !== '') payload.price = Number(form.price)
    if (String(form.discountedPrice).trim() !== '')
      payload.discountedPrice = Number(form.discountedPrice)
    try {
      const res = await servicesAPI.update(serviceId, payload)
      say('success', res.message || 'Service updated')
      setEditingId(null)
      loadServices()
    } catch (err) {
      say('error', apiError(err, 'Could not update the service'))
    }
  }

  const setNewField = key => e =>
    setNewService(s => ({ ...s, [key]: e.target.value }))

  const resetNewService = () => {
    setNewService({
      name: '',
      type: 'consultation',
      description: '',
      durationMinutes: '',
      price: '',
      doctorName: '',
      promoLabel: '',
      discountedPrice: ''
    })
    setShowNewService(false)
  }

  const createService = async e => {
    e.preventDefault()
    if (creating) return
    // create_service.py requires name/type/description/durationMinutes/price
    // and rejects empty optional fields, so send those only when filled.
    const payload = {
      name: newService.name.trim(),
      type: newService.type.trim(),
      description: newService.description.trim(),
      durationMinutes: Number(newService.durationMinutes),
      price: Number(newService.price)
    }
    if (newService.doctorName.trim() !== '')
      payload.doctorName = newService.doctorName.trim()
    if (newService.promoLabel.trim() !== '')
      payload.promoLabel = newService.promoLabel.trim()
    if (String(newService.discountedPrice).trim() !== '')
      payload.discountedPrice = Number(newService.discountedPrice)

    setCreating(true)
    try {
      const res = await servicesAPI.create(payload)
      say('success', res.message || 'Service created')
      resetNewService()
      loadServices()
    } catch (err) {
      say('error', apiError(err, 'Could not create the service'))
    } finally {
      setCreating(false)
    }
  }

  const serviceName = serviceId => {
    const svc = services.find(s => s.serviceId === serviceId)
    return svc ? svc.name : serviceId
  }

  const loadPending = useCallback(() => {
    appointmentAPI
      .listByStatus('PENDING')
      .then(res => setPending(res.data || []))
      .catch(() => setPending([]))
  }, [])

  const loadServices = useCallback(() => {
    servicesAPI
      .getAll()
      .then(res => setServices(res.data || []))
      .catch(() => setServices([]))
  }, [])

  const loadFeedback = useCallback(() => {
    feedbackAPI
      .getAll()
      .then(res => setFeedback(res.data || []))
      .catch(() => setFeedback([]))
  }, [])

  const loadConcerns = useCallback(() => {
    console.log('[concerns] configured?', communicationAPI.isConfigured())
    if (!communicationAPI.isConfigured()) {
      console.warn(
        '[concerns] REACT_APP_GCP_PROJECT_ID is blank, skipping fetch'
      )
      return
    }
    communicationAPI
      .getLogs()
      .then(logs => {
        console.log('[concerns] got', logs.length, 'logs', logs)
        setConcerns(logs)
      })
      .catch(err => {
        console.error(
          '[concerns] failed:',
          err.response?.status,
          err.response?.data || err.message
        )
        setConcerns([])
      })
  }, [])

  useEffect(() => {
    if (getRole() !== 'Coordinator') {
      navigate('/login')
      return
    }
    loadPending()
    loadServices()
    loadConcerns()
    loadFeedback()
  }, [navigate, loadPending, loadServices, loadConcerns, loadFeedback])

  useEffect(() => {
    if (!chatConcernId) return undefined
    const onKey = e => e.key === 'Escape' && setChatConcernId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatConcernId])

  const handleApprove = async appointmentId => {
    try {
      const res = await appointmentAPI.approve(appointmentId)
      say('success', res.message)
      loadPending()
    } catch (err) {
      say('error', apiError(err, 'Could not approve this appointment'))
    }
  }

  const handleReject = async appointmentId => {
    const rejectionReason = window.prompt('Reason for rejection?')
    if (!rejectionReason) return
    try {
      const res = await appointmentAPI.reject(appointmentId, rejectionReason)
      say('success', res.message)
      loadPending()
    } catch (err) {
      say('error', apiError(err, 'Could not reject this appointment'))
    }
  }

  const handleSendReply = async concernId => {
    const message = (replyDrafts[concernId] || '').trim()
    if (!message || sendingReply) return
    setSendingReply(true)
    try {
      await communicationAPI.sendReply({
        concernId,
        sender: 'coordinator',
        senderId: user ? user.username : '',
        message
      })
      setReplyDrafts(prev => ({ ...prev, [concernId]: '' }))
      loadConcerns()
    } catch (err) {
      say('error', apiError(err, 'Could not send your reply'))
    } finally {
      setSendingReply(false)
    }
  }

  const handleViewLogs = async appointmentId => {
    try {
      const res = await appointmentAPI.getLogs(appointmentId)
      setLogs({ appointmentId, entries: res.data || [] })
    } catch (err) {
      say('error', apiError(err, 'Could not load the audit trail'))
    }
  }

  // Read the open chat's concern out of `concerns` rather than copying it into
  // state, so loadConcerns() after a reply refreshes the thread in place.
  const chatConcern = concerns.find(c => c.id === chatConcernId) || null

  const openCount = concerns.filter(c => c.status === 'OPEN').length
  const unassignedCount = concerns.filter(c => c.status === 'UNASSIGNED').length

  // Newest feedback first -- a DynamoDB scan returns rows in no useful order.
  const sortedFeedback = [...feedback].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  )

  // Newest first: Firestore returns communicationLogs in document-id order,
  // which is effectively random, so sort before slicing into pages.
  const sortedConcerns = [...concerns].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  )
  const concernPageCount = Math.ceil(sortedConcerns.length / CONCERNS_PER_PAGE)
  // A reply can shrink the list under the current page (loadConcerns refetches),
  // so clamp rather than render an empty page.
  const currentConcernPage = Math.min(
    concernPage,
    Math.max(concernPageCount - 1, 0)
  )
  const visibleConcerns = sortedConcerns.slice(
    currentConcernPage * CONCERNS_PER_PAGE,
    currentConcernPage * CONCERNS_PER_PAGE + CONCERNS_PER_PAGE
  )

  return (
    <DashLayout name={user ? user.username : '-'} role='Coordinator' nav={NAV}>
      <h1 id='top'>Dashboard</h1>
      <p className='dash-date'>Wellness coordination overview</p>

      {notice && (
        <div
          className={`alert alert-${
            notice.kind === 'success' ? 'success' : 'error'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className='stat-row'>
        <div className='stat-card'>
          <div>
            <div className='stat-card-value'>{pending.length}</div>
            <div className='stat-card-label'>Pending requests</div>
          </div>
          <span className='stat-card-icon'>📅</span>
        </div>
        <div className='stat-card'>
          <div>
            <div className='stat-card-value'>{openCount}</div>
            <div className='stat-card-label'>Open concerns</div>
          </div>
          <span className='stat-card-icon'>💬</span>
        </div>
        <div className='stat-card'>
          <div>
            <div className='stat-card-value'>{unassignedCount}</div>
            <div className='stat-card-label'>Unassigned concerns</div>
          </div>
          <span className='stat-card-icon'>📥</span>
        </div>
      </div>

      <div className='dash-cols section'>
        <div className='card' id='pending' style={{ maxWidth: 'none' }}>
          <h3 className='card-title'>Pending requests</h3>
          {pending.length === 0 ? (
            <p className='card-subtitle'>Nothing waiting for review.</p>
          ) : (
            <div className='table-wrap'>
              <table className='table'>
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Service</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(a => (
                    <tr key={a.appointmentId}>
                      <td>
                        <strong>{a.patientUsername}</strong>
                        <div className='msg-meta'>Ref {a.appointmentId}</div>
                      </td>
                      <td>
                        <span className='status'>
                          {serviceName(a.serviceId)}
                        </span>
                      </td>
                      <td>
                        {a.date}
                        <div className='msg-meta'>{a.time}</div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.35rem'
                          }}
                        >
                          <button
                            className='btn btn-inline'
                            type='button'
                            onClick={() => handleApprove(a.appointmentId)}
                          >
                            Approve
                          </button>
                          <button
                            className='btn btn-secondary btn-inline'
                            type='button'
                            onClick={() => handleReject(a.appointmentId)}
                          >
                            Reject
                          </button>
                          <button
                            className='btn btn-secondary btn-inline'
                            type='button'
                            onClick={() => handleViewLogs(a.appointmentId)}
                          >
                            Logs
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {logs && (
            <div className='section'>
              <h3 className='card-title' style={{ fontSize: '1.05rem' }}>
                Audit trail · {logs.appointmentId}
              </h3>
              {logs.entries.length === 0 ? (
                <p className='card-subtitle'>No log entries.</p>
              ) : (
                <div className='table-wrap'>
                  <table className='table'>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>By</th>
                        <th>Details</th>
                        <th>At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.entries.map(entry => (
                        <tr key={entry.logId}>
                          <td>{entry.action}</td>
                          <td>{entry.performedBy}</td>
                          <td>{entry.details}</td>
                          <td>{formatDateTime(entry.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className='card' id='concerns' style={{ maxWidth: 'none' }}>
          <h3 className='card-title'>Recent patient messages</h3>
          <p className='card-subtitle'>
            Concerns assigned via Pub/Sub → communicationLogs.
          </p>
          {!communicationAPI.isConfigured() ? (
            <p className='field-hint'>
              Set REACT_APP_GCP_PROJECT_ID (and REACT_APP_FIREBASE_API_KEY) to
              load concerns.
            </p>
          ) : concerns.length === 0 ? (
            <p className='card-subtitle'>No concerns logged yet.</p>
          ) : (
            visibleConcerns.map(c => (
              <div className='msg' key={c.id}>
                <span className='avatar'>
                  {initialsOf(displayPatientId(c.patientId))}
                </span>
                <div className='msg-body'>
                  <div className='msg-name'>
                    {displayPatientId(c.patientId)}
                  </div>
                  <p className='msg-text'>{c.concern}</p>
                  <div className='msg-meta'>
                    <span
                      className={`status ${String(c.status).toLowerCase()}`}
                    >
                      {c.status}
                    </span>{' '}
                    {c.coordinatorId
                      ? `assigned to ${displayCoordinatorId(c.coordinatorId)}`
                      : 'awaiting a coordinator'}{' '}
                    · {formatDateTime(c.createdAt)}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      marginTop: '0.5rem'
                    }}
                  >
                    <button
                      className='btn btn-inline'
                      type='button'
                      onClick={() => setChatConcernId(c.id)}
                    >
                      Open chat
                    </button>
                    <span className='card-subtitle' style={{ margin: 0 }}>
                      {replyCountOf(c) === 0
                        ? 'No replies yet'
                        : `${replyCountOf(c)} ${
                            replyCountOf(c) === 1 ? 'reply' : 'replies'
                          }`}
                      {c.lastMessageAt
                        ? ` · last ${formatDateTime(c.lastMessageAt)}`
                        : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}

          {concernPageCount > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginTop: '1rem'
              }}
            >
              <button
                className='btn btn-inline'
                type='button'
                disabled={currentConcernPage === 0}
                onClick={() => setConcernPage(p => Math.max(p - 1, 0))}
              >
                ← Previous
              </button>
              <span className='card-subtitle' style={{ margin: 0 }}>
                Page {currentConcernPage + 1} of {concernPageCount} ·{' '}
                {sortedConcerns.length} concerns
              </span>
              <button
                className='btn btn-inline'
                type='button'
                disabled={currentConcernPage >= concernPageCount - 1}
                onClick={() =>
                  setConcernPage(p => Math.min(p + 1, concernPageCount - 1))
                }
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className='card section' id='services' style={{ maxWidth: 'none' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem'
          }}
        >
          <div>
            <h3 className='card-title'>Manage services</h3>
            <p className='card-subtitle'>
              Add a service, or set the doctor/specialist and promotional
              package for an existing one.
            </p>
          </div>
          <button
            className='btn btn-inline'
            type='button'
            onClick={() =>
              showNewService ? resetNewService() : setShowNewService(true)
            }
          >
            {showNewService ? 'Cancel' : '+ Add service'}
          </button>
        </div>

        {showNewService && (
          <form
            onSubmit={createService}
            style={{
              margin: '1rem 0',
              padding: '1rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)'
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0 1rem'
              }}
            >
              <div className='field'>
                <label htmlFor='new-name'>Name</label>
                <input
                  id='new-name'
                  value={newService.name}
                  onChange={setNewField('name')}
                  placeholder='General Consultation'
                  required
                />
              </div>
              <div className='field'>
                <label htmlFor='new-type'>Type</label>
                <select
                  id='new-type'
                  value={newService.type}
                  onChange={setNewField('type')}
                  required
                >
                  <option value='consultation'>consultation</option>
                  <option value='therapy'>therapy</option>
                  <option value='wellness'>wellness</option>
                </select>
              </div>
              <div className='field'>
                <label htmlFor='new-duration'>Duration (minutes)</label>
                <input
                  id='new-duration'
                  type='number'
                  min='1'
                  value={newService.durationMinutes}
                  onChange={setNewField('durationMinutes')}
                  placeholder='30'
                  required
                />
              </div>
              <div className='field'>
                <label htmlFor='new-price'>Price</label>
                <input
                  id='new-price'
                  type='number'
                  min='0'
                  step='0.01'
                  value={newService.price}
                  onChange={setNewField('price')}
                  placeholder='50'
                  required
                />
              </div>
              <div className='field'>
                <label htmlFor='new-doctor'>Doctor / specialist</label>
                <input
                  id='new-doctor'
                  value={newService.doctorName}
                  onChange={setNewField('doctorName')}
                  placeholder='Dr. Name (optional)'
                />
              </div>
              <div className='field'>
                <label htmlFor='new-promo'>Promotion label</label>
                <input
                  id='new-promo'
                  value={newService.promoLabel}
                  onChange={setNewField('promoLabel')}
                  placeholder='Optional'
                />
              </div>
              <div className='field'>
                <label htmlFor='new-discount'>Discounted price</label>
                <input
                  id='new-discount'
                  type='number'
                  min='0'
                  step='0.01'
                  value={newService.discountedPrice}
                  onChange={setNewField('discountedPrice')}
                  placeholder='Must be below price'
                />
              </div>
            </div>
            <div className='field'>
              <label htmlFor='new-description'>Description</label>
              <input
                id='new-description'
                value={newService.description}
                onChange={setNewField('description')}
                placeholder='What this service covers'
                required
              />
            </div>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button className='btn' type='submit' disabled={creating}>
                {creating ? 'Creating…' : 'Create service'}
              </button>
              <button
                className='btn btn-secondary'
                type='button'
                onClick={resetNewService}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {services.length === 0 ? (
          <p className='card-subtitle'>No services yet.</p>
        ) : (
          <div className='table-wrap'>
            <table className='table'>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Doctor / specialist</th>
                  <th>Price</th>
                  <th>Promotion</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {services.map(s =>
                  editingId === s.serviceId ? (
                    <tr key={s.serviceId}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>
                        <input
                          className='input'
                          value={form.doctorName}
                          onChange={setField('doctorName')}
                          placeholder='Dr. Name'
                        />
                      </td>
                      <td>
                        <input
                          className='input'
                          type='number'
                          min='0'
                          step='0.01'
                          value={form.price}
                          onChange={setField('price')}
                          style={{ width: '6rem' }}
                        />
                      </td>
                      <td>
                        <input
                          className='input'
                          value={form.promoLabel}
                          onChange={setField('promoLabel')}
                          placeholder='Bundle: 3 sessions'
                        />
                        <input
                          className='input'
                          type='number'
                          min='0'
                          step='0.01'
                          value={form.discountedPrice}
                          onChange={setField('discountedPrice')}
                          placeholder='Discounted price'
                          style={{ marginTop: '0.35rem' }}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.35rem'
                          }}
                        >
                          <button
                            className='btn btn-inline'
                            type='button'
                            onClick={() => saveService(s.serviceId)}
                          >
                            Save
                          </button>
                          <button
                            className='btn btn-secondary btn-inline'
                            type='button'
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.serviceId}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>
                        {s.doctorName || (
                          <span className='card-subtitle'>-</span>
                        )}
                      </td>
                      <td>${s.price}</td>
                      <td>
                        {s.promoLabel && s.discountedPrice ? (
                          <span>
                            <span className='status open'>{s.promoLabel}</span>{' '}
                            ${s.discountedPrice}
                          </span>
                        ) : (
                          <span className='card-subtitle'>-</span>
                        )}
                      </td>
                      <td>
                        <button
                          className='btn btn-secondary btn-inline'
                          type='button'
                          onClick={() => startEdit(s)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className='card section' id='feedback' style={{ maxWidth: 'none' }}>
        <h3 className='card-title'>Patient feedback</h3>
        <p className='card-subtitle'>
          Submitted after appointments. Sentiment is scored asynchronously by
          the analytics pipeline, so recent entries may not have a label yet.
        </p>
        {feedback.length === 0 ? (
          <p className='card-subtitle'>No feedback submitted yet.</p>
        ) : (
          <div className='table-wrap'>
            <table className='table'>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Service</th>
                  <th>Feedback</th>
                  <th>Sentiment</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {sortedFeedback.map(f => (
                  <tr key={f.feedbackId}>
                    <td>{f.patientUsername || 'Unknown'}</td>
                    <td>{serviceName(f.serviceId)}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{f.feedbackText}</td>
                    <td>
                      {f.sentimentLabel ? (
                        <span
                          className={`status ${
                            SENTIMENT_STATUS[f.sentimentLabel] || 'pending'
                          }`}
                          title={
                            f.sentimentScore !== undefined
                              ? `score ${f.sentimentScore}`
                              : undefined
                          }
                        >
                          {f.sentimentLabel}
                        </span>
                      ) : (
                        <span className='card-subtitle'>-</span>
                      )}
                    </td>
                    <td>{formatDateTime(f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className='card section' id='analytics' style={{ maxWidth: 'none' }}>
        <h3 className='card-title'>Analytics dashboard</h3>
        {LOOKER_URL ? (
          <iframe
            className='looker-embed'
            title='SAWS analytics (Looker Studio)'
            src={LOOKER_URL}
            allowFullScreen
          />
        ) : (
          <p className='field-hint'>
            Set REACT_APP_LOOKER_REPORT_URL to embed the Looker Studio report.
          </p>
        )}
      </div>

      {chatConcern && (
        <div
          role='presentation'
          onClick={() => setChatConcernId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(28, 26, 36, 0.55)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 100
          }}
        >
          {/* Stop propagation so clicks inside the dialog don't hit the
              backdrop's close handler. */}
          <div
            className='card'
            role='dialog'
            aria-modal='true'
            aria-label={`Conversation with ${displayPatientId(
              chatConcern.patientId
            )}`}
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(560px, 100%)',
              maxHeight: '82vh',
              display: 'flex',
              flexDirection: 'column',
              margin: 0,
              boxShadow: 'var(--shadow)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '1rem',
                paddingBottom: '0.85rem',
                borderBottom: '1px solid var(--color-border)'
              }}
            >
              <div>
                <h3 className='card-title' style={{ marginBottom: '0.25rem' }}>
                  {displayPatientId(chatConcern.patientId)}
                </h3>
                <p className='card-subtitle' style={{ margin: 0 }}>
                  <span
                    className={`status ${String(
                      chatConcern.status
                    ).toLowerCase()}`}
                  >
                    {chatConcern.status}
                  </span>{' '}
                  · {formatDateTime(chatConcern.createdAt)}
                </p>
              </div>
              <button
                className='btn btn-inline'
                type='button'
                aria-label='Close conversation'
                onClick={() => setChatConcernId(null)}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                margin: '1rem 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
              }}
            >
              {/* Pre-`messages` documents only have the `concern` string, so
                  fall back to it rather than showing an empty thread. */}
              {(chatConcern.messages && chatConcern.messages.length
                ? chatConcern.messages
                : [
                    {
                      messageId: 'original',
                      sender: 'patient',
                      text: chatConcern.concern,
                      sentAt: chatConcern.createdAt
                    }
                  ]
              ).map(m => (
                <div
                  key={m.messageId}
                  style={{
                    alignSelf:
                      m.sender === 'coordinator' ? 'flex-end' : 'flex-start',
                    maxWidth: '78%',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '14px',
                    // Squared-off corner on the sender's side, the usual chat
                    // cue for who said what.
                    borderBottomRightRadius:
                      m.sender === 'coordinator' ? '4px' : '14px',
                    borderBottomLeftRadius:
                      m.sender === 'coordinator' ? '14px' : '4px',
                    background:
                      m.sender === 'coordinator'
                        ? 'var(--color-primary)'
                        : 'var(--color-bg)',
                    border:
                      m.sender === 'coordinator'
                        ? 'none'
                        : '1px solid var(--color-border)',
                    color:
                      m.sender === 'coordinator'
                        ? '#ffffff'
                        : 'var(--color-text)'
                  }}
                >
                  <p
                    className='msg-text'
                    style={{ margin: 0, color: 'inherit' }}
                  >
                    {m.text}
                  </p>
                  <span
                    style={{
                      display: 'block',
                      marginTop: '0.3rem',
                      fontSize: '0.72rem',
                      color:
                        m.sender === 'coordinator'
                          ? 'rgba(255,255,255,0.85)'
                          : 'var(--color-text-muted)'
                    }}
                  >
                    {m.sender === 'coordinator' ? 'You' : 'Patient'} ·{' '}
                    {formatDateTime(m.sentAt)}
                  </span>
                </div>
              ))}
            </div>

            {communicationAPI.isReplyConfigured() ? (
              // Enter submits, so this is a real form. It matches the login /
              // register pages' .field + .btn markup rather than bare inputs.
              <form
                onSubmit={e => {
                  e.preventDefault()
                  handleSendReply(chatConcern.id)
                }}
                style={{
                  borderTop: '1px solid var(--color-border)',
                  paddingTop: '1rem'
                }}
              >
                <div className='field' style={{ marginBottom: '0.75rem' }}>
                  <label htmlFor={`reply-${chatConcern.id}`}>
                    Reply to {displayPatientId(chatConcern.patientId)}
                  </label>
                  <input
                    autoFocus
                    id={`reply-${chatConcern.id}`}
                    placeholder='Type your reply…'
                    autoComplete='off'
                    value={replyDrafts[chatConcern.id] || ''}
                    onChange={e =>
                      setReplyDrafts(prev => ({
                        ...prev,
                        [chatConcern.id]: e.target.value
                      }))
                    }
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <button
                    className='btn'
                    type='submit'
                    disabled={
                      sendingReply ||
                      !(replyDrafts[chatConcern.id] || '').trim()
                    }
                  >
                    {sendingReply ? 'Sending…' : 'Send reply'}
                  </button>
                  <button
                    className='btn btn-secondary'
                    type='button'
                    onClick={() => setChatConcernId(null)}
                  >
                    Close
                  </button>
                </div>
              </form>
            ) : (
              <p className='field-hint' style={{ margin: 0 }}>
                Set REACT_APP_POST_REPLY_URL to enable replies.
              </p>
            )}
          </div>
        </div>
      )}
    </DashLayout>
  )
}
