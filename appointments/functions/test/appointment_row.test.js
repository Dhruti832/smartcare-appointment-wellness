const { parseAppointmentRow, toFirestoreDoc } = require('../appointment_row');

const CSV = 'refCode,date,service,status\nA1,2026-08-01,svc-001,PENDING\n';

describe('parseAppointmentRow', () => {
  test('parses a matching row', () => {
    const row = parseAppointmentRow(CSV, 'A1');
    expect(row).toEqual({ refCode: 'A1', date: '2026-08-01', service: 'svc-001', status: 'PENDING' });
  });

  test('returns null when the refCode does not match', () => {
    expect(parseAppointmentRow(CSV, 'A2')).toBeNull();
  });

  test('returns null for empty CSV', () => {
    expect(parseAppointmentRow('refCode,date,service,status\n', 'A1')).toBeNull();
  });
});

describe('toFirestoreDoc', () => {
  test('keeps all fields', () => {
    const doc = toFirestoreDoc({ refCode: 'A1', date: '2026-08-01', service: 'svc-001', status: 'APPROVED' });
    expect(doc).toEqual({ refCode: 'A1', date: '2026-08-01', service: 'svc-001', status: 'APPROVED' });
  });

  test('empty values become null', () => {
    const doc = toFirestoreDoc({ refCode: 'A1', date: '', service: 'svc-001', status: '' });
    expect(doc.date).toBeNull();
    expect(doc.status).toBeNull();
  });
});
