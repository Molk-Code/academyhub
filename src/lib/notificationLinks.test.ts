import { describe, it, expect } from 'vitest'
import { notificationTarget } from './notificationLinks'

describe('notificationTarget', () => {
  it('keeps links the role can open, with the item to focus', () => {
    expect(notificationTarget('/my-bookings?focus=b1', 'student')).toBe('/my-bookings?focus=b1')
    expect(notificationTarget('/admin/equipment?tab=bookings&focus=b1', 'admin')).toBe('/admin/equipment?tab=bookings&focus=b1')
    expect(notificationTarget('/teacher/gradebook?submission=s1', 'teacher')).toBe('/teacher/gradebook?submission=s1')
    expect(notificationTarget('/assignments/a1', 'student')).toBe('/assignments/a1')
  })
  it('sends teachers to their version of the page', () => {
    expect(notificationTarget('/my-bookings?focus=p1', 'teacher')).toBe('/teacher/my-bookings?focus=p1')
    expect(notificationTarget('/admin/equipment?tab=bookings&focus=b1', 'teacher')).toBe('/teacher/equipment-requests?focus=b1')
    expect(notificationTarget('/chat?channel=c1', 'teacher')).toBe('/teacher/chat?channel=c1')
    expect(notificationTarget('/calendar', 'teacher')).toBe('/teacher/lessons')
  })
  it('sends admins to admin pages where they exist', () => {
    expect(notificationTarget('/chat?channel=c1', 'admin')).toBe('/admin/chat?channel=c1')
    expect(notificationTarget('/teacher/equipment-requests?focus=b1', 'admin')).toBe('/admin/equipment?focus=b1&tab=bookings')
    expect(notificationTarget('/my-bookings?focus=p1', 'admin')).toBe('/my-bookings?focus=p1')
  })
  it('students never get staff pages', () => {
    expect(notificationTarget('/teacher/my-bookings?focus=p1', 'student')).toBe('/my-bookings?focus=p1')
  })
  it('old absolute links open inside the app; foreign or broken links go home', () => {
    expect(notificationTarget('https://cineforge.se/my-bookings/', 'student')).toBe('/my-bookings')
    expect(notificationTarget('https://evil.example/x', 'student')).toBe('/x')
    expect(notificationTarget('//evil.example/x', 'student')).toBe('/x')
    expect(notificationTarget(undefined, 'student')).toBe('/')
    expect(notificationTarget('', null)).toBe('/')
  })
})
