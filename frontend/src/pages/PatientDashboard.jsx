import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  apiError,
  appointmentAPI,
  communicationAPI,
  feedbackAPI,
  messagingAPI,
  servicesAPI
} from '../services/api'
import { getUser, isLoggedIn } from '../services/session'
import ChatbotWidget from '../components/ChatbotWidget'
import DashLayout from '../components/DashLayout'

const CANCELLABLE = ['PENDING', 'APPROVED']

const NAV = [
  { icon: '▦', label: 'Dashboard', href: '#top', active: true },
  { icon: '📅', label: 'Book', href: '#book' },
  { icon: '🕘', label: 'History', href: '#history' },
  { icon: '📝', label: 'Feedback', href: '#feedback' },
  { icon: '💬', label: 'Chat', href: '#concern' },
  { icon: '🗨️', label: 'My concerns', href: '#my-concerns' }
]

// Concern timestamps are raw ISO strings from Firestore, so render them as
// something readable, same treatment as CoordinatorDashboard's formatDateTime.
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

function greeting () {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function PatientDashboard () {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Memoised because getUser() decodes the token into a fresh object on every
  // call. As a plain `const user = getUser()` it was a new reference each
  // render, so loadMyConcerns (which depends on it) was rebuilt every render,
  // which re-fired the mount effect below, which set state, which re-rendered,
  // an endless services/appointments/communicationLogs request loop.
  const user = useMemo(() => getUser(), [])
  const [services, setServices] = useState([])
  const [appointments, setAppointments] = useState([])
  // Preselects the service when arriving via a "Book this service" link
  // from the service detail page (?service=svc-001#book).
  const [booking, setBooking] = useState({
    serviceId: searchParams.get('service') || '',
    date: '',
    time: ''
  })
  const [feedback, setFeedback] = useState({
    appointmentId: '',
    feedbackText: ''
  })
  const [concern, setConcern] = useState('')
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [myConcerns, setMyConcerns] = useState([])
  const [replyDrafts, setReplyDrafts] = useState({})
  const [sendingReply, setSendingReply] = useState(false)

  const say = (kind, text) => setNotice({ kind, text })

  const loadAppointments = useCallback(() => {
    appointmentAPI
      .getMine()
      .then(res => setAppointments(res.data || []))
      .catch(() => setAppointments([]))
  }, [])

  const loadMyConcerns = useCallback(() => {
    if (!communicationAPI.isConfigured() || !user) return
    communicationAPI
      .getLogs()
      .then(logs =>
        setMyConcerns(logs.filter(c => c.patientId === user.username))
      )
      .catch(() => setMyConcerns([]))
  }, [user])

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate('/login')
      return
    }
    servicesAPI
      .getAll()
      .then(res => setServices(res.data || []))
      .catch(() => setServices([]))
    loadAppointments()
    loadMyConcerns()
  }, [navigate, loadAppointments, loadMyConcerns])

  const handleBook = async e => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await appointmentAPI.book(booking)
      say(
        'success',
        `${res.message} · reference ${res.data.appointmentId} (${res.data.status})`
      )
      setBooking({ serviceId: '', date: '', time: '' })
      loadAppointments()
    } catch (err) {
      say(
        'error',
        apiError(err, 'Booking failed. Is the appointments API reachable?')
      )
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async appointmentId => {
    try {
      const res = await appointmentAPI.cancel(appointmentId)
      say('success', res.message)
      loadAppointments()
    } catch (err) {
      say('error', apiError(err, 'Could not cancel this appointment'))
    }
  }

  const handleFeedback = async e => {
    e.preventDefault()
    const appointment = appointments.find(
      a => a.appointmentId === feedback.appointmentId
    )
    try {
      const res = await feedbackAPI.submit({
        appointmentId: feedback.appointmentId,
        serviceId: appointment ? appointment.serviceId : '',
        feedbackText: feedback.feedbackText
      })
      say('success', `${res.message} · sentiment analysis runs shortly`)
      setFeedback({ appointmentId: '', feedbackText: '' })
    } catch (err) {
      say('error', apiError(err, 'Could not submit feedback'))
    }
  }

  const handleConcern = async e => {
    e.preventDefault()
    try {
      const res = await messagingAPI.submitConcern({
        patientId: user ? user.username : '',
        concern,
        sessionId: `web-${Date.now()}`
      })
      say('success', `Concern sent to a coordinator (message ${res.messageId})`)
      setConcern('')
    } catch (err) {
      say('error', apiError(err, 'Could not submit your concern'))
    }
  }

  const handleSendReply = async concernId => {
    const message = (replyDrafts[concernId] || '').trim()
    // postReply appends with arrayUnion and a fresh messageId per call, so a
    // double-click would persist two copies rather than dedupe them.
    if (!message || sendingReply) return
    setSendingReply(true)
    try {
      await communicationAPI.sendReply({
        concernId,
        sender: 'patient',
        senderId: user ? user.username : '',
        message
      })
      setReplyDrafts(prev => ({ ...prev, [concernId]: '' }))
      loadMyConcerns()
    } catch (err) {
      say('error', apiError(err, 'Could not send your reply'))
    } finally {
      setSendingReply(false)
    }
  }

  const serviceName = serviceId => {
    const svc = services.find(s => s.serviceId === serviceId)
    return svc ? svc.name : serviceId
  }

  const upcoming = appointments.filter(a => CANCELLABLE.includes(a.status))
  const pendingCount = appointments.filter(a => a.status === 'PENDING').length
  const firstName = user ? user.username.split(/[@\s.]/)[0] : 'there'
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return (
    <DashLayout name={user ? user.username : '-'} role='Patient' nav={NAV}>
      <h1 id='top'>
        {greeting()}, {firstName}
      </h1>
      <p className='dash-date'>Today is {today}</p>

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
            <div className='stat-card-value'>{upcoming.length}</div>
            <div className='stat-card-label'>Upcoming appointments</div>
          </div>
          <span className='stat-card-icon'>📅</span>
        </div>
        <div className='stat-card'>
          <div>
            <div className='stat-card-value'>{pendingCount}</div>
            <div className='stat-card-label'>Awaiting approval</div>
          </div>
          <span className='stat-card-icon'>⏳</span>
        </div>
        <div className='stat-card'>
          <div>
            <div className='stat-card-value'>{appointments.length}</div>
            <div className='stat-card-label'>Total booked</div>
          </div>
          <span className='stat-card-icon'>🗂</span>
        </div>
      </div>

      <div className='dash-cols section'>
        <div>
          <h2 id='history' style={{ fontSize: '1.15rem' }}>
            Upcoming appointments
          </h2>
          {appointments.length === 0 ? (
            <p className='card-subtitle'>
              No appointments yet. Book your first one below.
            </p>
          ) : (
            appointments.map(a => (
              <div className='appt-card' key={a.appointmentId}>
                <div className='appt-card-info'>
                  <div className='appt-card-title'>
                    {serviceName(a.serviceId)}
                  </div>
                  <div className='appt-card-sub'>
                    Reference {a.appointmentId}
                  </div>
                </div>
                <span className='appt-card-when'>
                  📅 {a.date}, {a.time}
                </span>
                <span className={`status ${String(a.status).toLowerCase()}`}>
                  {a.status}
                </span>
                {CANCELLABLE.includes(a.status) && (
                  <button
                    className='btn btn-secondary btn-inline'
                    type='button'
                    onClick={() => handleCancel(a.appointmentId)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))
          )}

          <div className='card card-wide section' id='book'>
            <h3 className='card-title'>Book an appointment</h3>
            <form onSubmit={handleBook}>
              <div className='field'>
                <label>Service</label>
                {services.length > 0 ? (
                  <select
                    value={booking.serviceId}
                    onChange={e =>
                      setBooking({ ...booking, serviceId: e.target.value })
                    }
                    required
                  >
                    <option value=''>Choose a service…</option>
                    {services.map(s => (
                      <option key={s.serviceId} value={s.serviceId}>
                        {s.name} · ${s.price} / {s.durationMinutes} min
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    placeholder='Service ID (service list unavailable)'
                    value={booking.serviceId}
                    onChange={e =>
                      setBooking({ ...booking, serviceId: e.target.value })
                    }
                    required
                  />
                )}
              </div>
              <div className='field'>
                <label>Date</label>
                <input
                  type='date'
                  value={booking.date}
                  onChange={e =>
                    setBooking({ ...booking, date: e.target.value })
                  }
                  required
                />
              </div>
              <div className='field'>
                <label>Time</label>
                <input
                  type='time'
                  value={booking.time}
                  onChange={e =>
                    setBooking({ ...booking, time: e.target.value })
                  }
                  required
                />
              </div>
              <button className='btn' type='submit' disabled={loading}>
                {loading ? 'Booking…' : 'Book appointment'}
              </button>
            </form>
          </div>

          <div className='card card-wide section' id='feedback'>
            <h3 className='card-title'>Leave feedback</h3>
            <form onSubmit={handleFeedback}>
              <div className='field'>
                <label>Appointment</label>
                <select
                  value={feedback.appointmentId}
                  onChange={e =>
                    setFeedback({ ...feedback, appointmentId: e.target.value })
                  }
                  required
                >
                  <option value=''>Choose an appointment…</option>
                  {appointments.map(a => (
                    <option key={a.appointmentId} value={a.appointmentId}>
                      {a.appointmentId} · {serviceName(a.serviceId)} on {a.date}
                    </option>
                  ))}
                </select>
              </div>
              <div className='field'>
                <label>Feedback</label>
                <textarea
                  rows={3}
                  placeholder='How was your experience?'
                  value={feedback.feedbackText}
                  onChange={e =>
                    setFeedback({ ...feedback, feedbackText: e.target.value })
                  }
                  required
                />
              </div>
              <button className='btn' type='submit'>
                Submit feedback
              </button>
            </form>
          </div>
        </div>

        <div>
          <div className='card' id='concern' style={{ maxWidth: 'none' }}>
            <h3 className='card-title'>Raise a concern</h3>
            <p className='card-subtitle'>
              Sent to an available wellness coordinator via our messaging
              service.
            </p>
            <form onSubmit={handleConcern}>
              <div className='field'>
                <label>Your concern</label>
                <textarea
                  rows={4}
                  placeholder='Describe your concern…'
                  value={concern}
                  onChange={e => setConcern(e.target.value)}
                  required
                />
              </div>
              <button
                className='btn'
                type='submit'
                disabled={!messagingAPI.isConfigured()}
              >
                Submit concern
              </button>
              {!messagingAPI.isConfigured() && (
                <p className='field-hint'>
                  Set REACT_APP_PUBLISH_CONCERN_URL to enable this form.
                </p>
              )}
            </form>
          </div>

          <div
            className='card section'
            id='my-concerns'
            style={{ maxWidth: 'none' }}
          >
            <h3 className='card-title'>My concerns</h3>
            {!communicationAPI.isConfigured() ? (
              <p className='field-hint'>
                Set REACT_APP_GCP_PROJECT_ID to load your concerns.
              </p>
            ) : myConcerns.length === 0 ? (
              <p className='card-subtitle'>No concerns submitted yet.</p>
            ) : (
              myConcerns.map(c => (
                <div className='msg' key={c.id}>
                  <div className='msg-body'>
                    <p className='msg-text'>{c.concern}</p>
                    <div className='msg-meta'>
                      <span
                        className={`status ${String(c.status).toLowerCase()}`}
                      >
                        {c.status}
                      </span>{' '}
                      {c.coordinatorId
                        ? 'a coordinator has replied'
                        : 'awaiting a coordinator'}{' '}
                      · {formatDateTime(c.createdAt)}
                    </div>

                    {/* messages[0] is the concern itself, already shown above,
                        the thread is everything after it. */}
                    {(c.messages || []).length > 1 && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                          margin: '0.75rem 0'
                        }}
                      >
                        {c.messages.slice(1).map(m => (
                          <div
                            key={m.messageId}
                            style={{
                              alignSelf:
                                m.sender === 'patient'
                                  ? 'flex-end'
                                  : 'flex-start',
                              maxWidth: '78%',
                              padding: '0.6rem 0.85rem',
                              borderRadius: '14px',
                              borderBottomRightRadius:
                                m.sender === 'patient' ? '4px' : '14px',
                              borderBottomLeftRadius:
                                m.sender === 'patient' ? '14px' : '4px',
                              background:
                                m.sender === 'patient'
                                  ? 'var(--color-primary)'
                                  : 'var(--color-bg)',
                              border:
                                m.sender === 'patient'
                                  ? 'none'
                                  : '1px solid var(--color-border)',
                              color:
                                m.sender === 'patient'
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
                                  m.sender === 'patient'
                                    ? 'rgba(255,255,255,0.85)'
                                    : 'var(--color-text-muted)'
                              }}
                            >
                              {m.sender === 'patient' ? 'You' : 'Coordinator'} ·{' '}
                              {formatDateTime(m.sentAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {communicationAPI.isReplyConfigured() && (
                      // Enter submits, so this is a real form, same .field +
                      // .btn markup as the login / register pages.
                      <form
                        onSubmit={e => {
                          e.preventDefault()
                          handleSendReply(c.id)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-end',
                          gap: '0.6rem',
                          marginTop: '0.75rem'
                        }}
                      >
                        <div
                          className='field'
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <label htmlFor={`reply-${c.id}`}>
                            Reply to your coordinator
                          </label>
                          <input
                            id={`reply-${c.id}`}
                            placeholder='Type your reply…'
                            autoComplete='off'
                            value={replyDrafts[c.id] || ''}
                            onChange={e =>
                              setReplyDrafts(prev => ({
                                ...prev,
                                [c.id]: e.target.value
                              }))
                            }
                          />
                        </div>
                        <button
                          className='btn btn-inline'
                          type='submit'
                          disabled={
                            sendingReply || !(replyDrafts[c.id] || '').trim()
                          }
                        >
                          {sendingReply ? 'Sending…' : 'Send'}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className='cta-card section'>
            <h3>Need help right away?</h3>
            <p>
              Our virtual assistant can look up an appointment by its reference
              code, answer FAQs, and more.
            </p>
          </div>
        </div>
      </div>
      <ChatbotWidget />
    </DashLayout>
  )
}
