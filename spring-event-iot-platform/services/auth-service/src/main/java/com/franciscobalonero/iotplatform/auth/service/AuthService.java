package com.franciscobalonero.iotplatform.auth.service;

import com.franciscobalonero.iotplatform.auth.model.User;
import com.franciscobalonero.iotplatform.auth.repository.UserRepository;
import com.franciscobalonero.iotplatform.auth.util.JwtUtil;
import com.franciscobalonero.iotplatform.common.exception.ConflictException;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Set;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final JwtUtil jwtUtil;
    private final PasswordEncoder passwordEncoder;

    @PostConstruct
    public void init() {
        if (userRepository.findByUsername("admin").isEmpty()) {
            userRepository.save(User.builder()
                    .username("admin")
                    .password(passwordEncoder.encode("admin123"))
                    .roles(Set.of("ROLE_ADMIN"))
                    .build());
        }
    }

    public String login(String username, String password) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new BadCredentialsException("Invalid username or password"));

        if (passwordEncoder.matches(password, user.getPassword())) {
            return jwtUtil.generateToken(username, user.getRoles());
        } else {
            throw new BadCredentialsException("Invalid username or password");
        }
    }

    public void register(String username, String password) {
        if (userRepository.findByUsername(username).isPresent()) {
            throw new ConflictException("User already exists");
        }

        userRepository.save(User.builder()
                .username(username)
                .password(passwordEncoder.encode(password))
                .roles(Set.of("ROLE_USER"))
                .build());
    }
}
