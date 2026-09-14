"""One-off seeder so the app isn't empty on first load. Run locally with AWS
credentials active and SERVICES_TABLE_NAME set (defaults to saws-services-dev):

    python3 seed_services.py
"""
import os
import uuid

import boto3

dynamodb = boto3.resource('dynamodb')
services_table = dynamodb.Table(os.environ.get('SERVICES_TABLE_NAME', 'saws-services-dev'))

SERVICES = [
    {
        'name': 'General Consultation',
        'type': 'consultation',
        'description': 'A general wellness checkup with one of our coordinators.',
        'durationMinutes': 30,
        'price': 50,
        'doctorName': 'Dr. Sarah Chen',
    },
    {
        'name': 'Physiotherapy Session',
        'type': 'therapy',
        'description': 'One-on-one physiotherapy for mobility and recovery.',
        'durationMinutes': 45,
        'price': 75,
        'doctorName': 'Dr. Michael Osei',
        'promoLabel': 'Bundle: 3 sessions',
        'discountedPrice': 60,
    },
    {
        'name': 'Wellness & Nutrition Session',
        'type': 'wellness',
        'description': 'Guidance on nutrition, sleep, and general wellness habits.',
        'durationMinutes': 45,
        'price': 65,
        'doctorName': 'Dr. Priya Nair',
        'promoLabel': 'New patient offer',
        'discountedPrice': 50,
    },
    {
        'name': 'Mental Health Check-in',
        'type': 'consultation',
        'description': 'A confidential session focused on mental wellbeing.',
        'durationMinutes': 60,
        'price': 90,
        'doctorName': 'Dr. James Whitfield',
    },
]

if __name__ == '__main__':
    for service in SERVICES:
        service_id = f'svc-{uuid.uuid4().hex[:8]}'
        services_table.put_item(Item={'serviceId': service_id, 'active': True, **service})
        print(f'Seeded {service_id} — {service["name"]}')
